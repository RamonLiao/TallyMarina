import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Db } from '../store/db.js';
import { canonicalCoinType, CoinTypeError } from './normalize.js';
import { getAsset, insertAssetIfAbsent, deleteAsset, appendAssetLog, countAssetUsage,
         type AssetRow, type MetadataCapState } from './store.js';

export const MIN_REASON_LENGTH = 12;
const PLACEHOLDER_REASON = /^(n\/?a|none|-+|\.+|tbd|todo)$/i;

const METADATA_CAP_STATES: readonly MetadataCapState[] = ['UNKNOWN', 'CLAIMED', 'UNCLAIMED', 'DELETED'];

/**
 * Maps the proto CoinMetadata.MetadataCapState numeric enum (verified against @mysten/sui@2.19.0,
 * state_service.mjs: it decodes to a plain `number` 0-3 at runtime, NOT a string) to our stored
 * string. Fail-loud by design: an out-of-range value throws — NEVER `?? default`. A silent default
 * would fabricate a mutability verdict ("decimals still frozen?") the chain never actually gave.
 */
function metadataCapStateFromEnum(v: number): MetadataCapState {
  switch (v) {
    case 0: return 'UNKNOWN';
    case 1: return 'CLAIMED';
    case 2: return 'UNCLAIMED';
    case 3: return 'DELETED';
    default: throw new Error(`unknown CoinMetadata.MetadataCapState enum value: ${v}`);
  }
}

/** Raw, uncoerced CoinMetadata. `decimals` is optional here exactly as the proto declares it. */
export interface RawCoinInfo {
  decimals?: number;
  symbol?: string;
  name?: string;
  objectId?: string;
  metadataCapState?: string;
}

/** Resolves null when the coin has no metadata object. Throws ChainUnreachableError otherwise. */
export interface CoinInfoFetcher {
  getCoinInfo(coinType: string): Promise<RawCoinInfo | null>;
}

export class ChainUnreachableError extends Error {
  constructor(cause: string) { super(`chain unreachable: ${cause}`); this.name = 'ChainUnreachableError'; }
}

export class RegisterError extends Error {
  // The code is embedded in the message so callers can identify the failure by regex on
  // `.message` (e.g. tests using `.toThrow(/ASSET_IN_USE/)`) as well as by the `.code` property.
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(`${code}: ${message}`); this.name = 'RegisterError';
  }
}

export interface RegisterArgs {
  entityId: string; coinType: string;
  decimals?: number; symbol?: string; reason?: string;
  actor: string; now: string;
}

function assertValidDecimals(d: number): void {
  if (!Number.isInteger(d) || d < 0 || d > 36) {
    throw new RegisterError(400, 'COIN_METADATA_INVALID_DECIMALS', `decimals out of range: ${d}`);
  }
}

/**
 * Validates a metadataCapState string arriving from a CoinInfoFetcher (the boundary a fake
 * fetcher also crosses). Fail-loud: an unrecognised value throws rather than being coerced to
 * null — writing null would silently claim "we don't know the cap state" when in fact the source
 * asserted something we refused to interpret. Distinct from metadataCapStateFromEnum, which
 * guards the numeric proto→string edge inside the real grpc fetcher.
 */
function assertValidMetadataCapState(s: string): asserts s is MetadataCapState {
  if (!METADATA_CAP_STATES.includes(s as MetadataCapState)) {
    throw new RegisterError(502, 'COIN_METADATA_INVALID_CAP_STATE', `unrecognised metadataCapState: ${s}`);
  }
}

/**
 * Adapts SuiGrpcClient to CoinInfoFetcher.
 *
 * MUST NOT use the SDK's client.getCoinMetadata helper: it coerces a missing decimals to 0
 * (grpc/core.mjs:158) behind a required-number type, and its bare catch (:152-153) makes a
 * transport error indistinguishable from "this coin has no metadata". Both defeat the entire
 * point of this table. stateService.getCoinInfo() exposes the truly-optional proto field and
 * lets transport errors surface.
 *
 * Two deviations from the task brief, verified against @mysten/sui@2.19.0:
 *  - RpcOptions (state_service.client.d.mts:22 → @protobuf-ts/runtime-rpc rpc-options.d.ts:47)
 *    names the cancellation field `abort`, not `signal`.
 *  - The proto CoinMetadata (state_service.d.mts:65-117) carries no object `version` — only
 *    `id`, `decimals`, `name`, `symbol`, `metadata_cap_state`, ... So instead of an object
 *    version we source `metadataCapState` (field 8), the real audit re-verification anchor:
 *    it answers whether this coin's decimals can still be mutated (DELETED/UNKNOWN → frozen;
 *    CLAIMED/UNCLAIMED → a holder can still update metadata). It decodes as a numeric enum
 *    (0-3) at runtime; metadataCapStateFromEnum maps it and throws on anything else.
 */
export function makeGrpcCoinInfoFetcher(grpc: SuiGrpcClient, timeoutMs: number): CoinInfoFetcher {
  return {
    async getCoinInfo(coinType: string): Promise<RawCoinInfo | null> {
      let response: { metadata?: { decimals?: number; symbol?: string; name?: string; id?: string; metadataCapState?: number } };
      try {
        ({ response } = await grpc.stateService.getCoinInfo({ coinType }, { abort: AbortSignal.timeout(timeoutMs) }));
      } catch (err) {
        throw new ChainUnreachableError((err as Error).message);
      }
      if (!response.metadata) return null;
      const m = response.metadata;
      return {
        decimals: m.decimals, symbol: m.symbol, name: m.name, objectId: m.id,
        metadataCapState: m.metadataCapState === undefined ? undefined : metadataCapStateFromEnum(m.metadataCapState),
      };
    },
  };
}

export async function registerAsset(db: Db, fetcher: CoinInfoFetcher, args: RegisterArgs): Promise<{ status: 200 | 201; row: AssetRow }> {
  // Local, network-free format validation gates the outbound RPC (V5).
  let coinType: string;
  try {
    coinType = canonicalCoinType(args.coinType);
  } catch (e) {
    const err = e as CoinTypeError;
    throw new RegisterError(400, err.code, err.message);
  }

  let info: RawCoinInfo | null;
  try {
    info = await fetcher.getCoinInfo(coinType);
  } catch (e) {
    if (e instanceof ChainUnreachableError) {
      // Never fall through to the manual branch (D15/V6).
      throw new RegisterError(503, 'CHAIN_UNREACHABLE', e.message);
    }
    throw e;
  }

  let candidate: AssetRow;
  if (info !== null && info.decimals !== undefined) {
    assertValidDecimals(info.decimals);
    if (args.decimals !== undefined && args.decimals !== info.decimals) {
      appendAssetLog(db, { entityId: args.entityId, coinType, outcome: 'conflict',
        claimedDecimals: args.decimals, chainDecimals: info.decimals, actor: args.actor, at: args.now });
      throw new RegisterError(409, 'CHAIN_DECIMALS_MISMATCH',
        `on-chain metadata says ${info.decimals} decimals; chain wins`);
    }
    // Validate BEFORE store (fail-loud). Absent → null; present-but-illegal → throw, never null.
    let metadataCapState: MetadataCapState | null = null;
    if (info.metadataCapState !== undefined) {
      assertValidMetadataCapState(info.metadataCapState);
      metadataCapState = info.metadataCapState;
    }
    candidate = {
      entityId: args.entityId, coinType, decimals: info.decimals,
      symbol: info.symbol ?? coinType, displayName: info.name ?? info.symbol ?? coinType,
      source: 'chain', chainObjectId: info.objectId ?? null, metadataCapState,
      fetchedAt: args.now, decidedBy: null, reason: null, createdAt: args.now,
    };
  } else {
    const reasonOk = typeof args.reason === 'string'
      && args.reason.trim().length >= MIN_REASON_LENGTH
      && !PLACEHOLDER_REASON.test(args.reason.trim());
    if (args.decimals === undefined || !args.symbol || !reasonOk) {
      appendAssetLog(db, { entityId: args.entityId, coinType, outcome: 'rejected',
        detail: 'manual registration requires decimals, symbol and a substantive reason',
        actor: args.actor, at: args.now });
      throw new RegisterError(400, 'MANUAL_DECIMALS_REQUIRED',
        `no on-chain metadata; decimals, symbol and a reason (>= ${MIN_REASON_LENGTH} chars) are required`);
    }
    assertValidDecimals(args.decimals);
    candidate = {
      entityId: args.entityId, coinType, decimals: args.decimals,
      symbol: args.symbol, displayName: args.symbol,
      source: 'manual', chainObjectId: null, metadataCapState: null, fetchedAt: null,
      decidedBy: args.actor, reason: args.reason!.trim(), createdAt: args.now,
    };
  }

  const outcome = db.transaction(() => {
    const inserted = insertAssetIfAbsent(db, candidate);
    return { inserted, existing: getAsset(db, args.entityId, coinType)! };
  })();

  if (outcome.inserted === 'inserted') {
    appendAssetLog(db, { entityId: args.entityId, coinType, outcome: 'registered',
      decimals: candidate.decimals, source: candidate.source, actor: args.actor, at: args.now });
    return { status: 201, row: candidate };
  }

  if (outcome.existing.decimals !== candidate.decimals) {
    appendAssetLog(db, { entityId: args.entityId, coinType, outcome: 'conflict',
      claimedDecimals: candidate.decimals, chainDecimals: outcome.existing.decimals, actor: args.actor, at: args.now });
    throw new RegisterError(409, 'ASSET_DECIMALS_CONFLICT',
      `already registered at ${outcome.existing.decimals} decimals; decimals cannot change — this needs a restatement`);
  }
  return { status: 200, row: outcome.existing };
}

/**
 * D7b — the zero-blast-radius correction. A registration with nothing downstream has nothing
 * to restate; forcing restatement there would push people to register a new canonical variant
 * to route around immutability, polluting the master data the table exists to protect.
 */
export function correctAsset(db: Db, entityId: string, coinTypeRaw: string, actor: string, now: string): void {
  let coinType: string;
  try {
    coinType = canonicalCoinType(coinTypeRaw);
  } catch (e) {
    const err = e as CoinTypeError;
    throw new RegisterError(400, err.code, err.message);
  }
  if (getAsset(db, entityId, coinType) === null) {
    throw new RegisterError(404, 'ASSET_NOT_REGISTERED', `not registered: ${coinType}`);
  }
  const usage = countAssetUsage(db, entityId, coinType);
  if (usage.events > 0 || usage.jes > 0 || usage.anchored > 0) {
    throw new RegisterError(409, 'ASSET_IN_USE',
      `this asset already has entries posted (events=${usage.events}, jes=${usage.jes}, anchored=${usage.anchored}); correction requires a restatement`);
  }
  db.transaction(() => { deleteAsset(db, entityId, coinType); })();
  appendAssetLog(db, { entityId, coinType, outcome: 'corrected', actor, at: now });
}
