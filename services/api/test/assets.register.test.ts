import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { getAsset, insertAssetIfAbsent } from '../src/assets/store.js';
import { registerAsset, correctAsset, makeGrpcCoinInfoFetcher, ChainUnreachableError, RegisterError,
         type CoinInfoFetcher, type RawCoinInfo } from '../src/assets/register.js';
import type { SuiGrpcClient } from '@mysten/sui/grpc';

const tmpDirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'assetreg3-')); tmpDirs.push(dir);
  const db = openDb(join(dir, 'test.db'));
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('e1','E1','0xc','0xcap','0xpkg')`).run();
  return db;
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const SUI = '0x2::sui::SUI';
const SUI_LONG = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const NOW = '2026-07-10T00:00:00Z';
const REASON = 'private coin, no on-chain metadata published';

const fetcherOf = (fn: (c: string) => Promise<RawCoinInfo | null>): CoinInfoFetcher => ({ getCoinInfo: fn });
const chainHit: CoinInfoFetcher = fetcherOf(async () => ({ decimals: 9, symbol: 'SUI', name: 'Sui', objectId: '0xmeta', metadataCapState: 'DELETED' }));
const noMetadata: CoinInfoFetcher = fetcherOf(async () => null);
const metadataWithoutDecimals: CoinInfoFetcher = fetcherOf(async () => ({ symbol: 'X', name: 'X', objectId: '0xm', metadataCapState: 'UNKNOWN' }));
const unreachable: CoinInfoFetcher = fetcherOf(async () => { throw new ChainUnreachableError('ECONNRESET'); });

describe('registerAsset — chain path', () => {
  it('registers from chain metadata under the canonical coinType', async () => {
    const db = freshDb();
    const { status, row } = await registerAsset(db, chainHit, { entityId: 'e1', coinType: SUI, actor: 'demo-controller', now: NOW });
    expect(status).toBe(201);
    expect(row.source).toBe('chain');
    // WHY (D16): metadataCapState is the re-verification anchor — DELETED means decimals are
    // permanently frozen, so it must survive the round-trip into the persisted row verbatim.
    expect(row.metadataCapState).toBe('DELETED');
    expect(getAsset(db, 'e1', SUI_LONG)!.metadataCapState).toBe('DELETED');
    expect(getAsset(db, 'e1', SUI_LONG)!.decimals).toBe(9);
  });

  it('persists a CLAIMED cap state (decimals still mutable — the verdict has an expiry)', async () => {
    // WHY: CLAIMED is the opposite pole from DELETED — a holder can still update metadata, so a
    // "chain-verified" guarantee is time-bounded. The exact state must land, not be flattened.
    const db = freshDb();
    const claimed = fetcherOf(async () => ({ decimals: 9, symbol: 'SUI', name: 'Sui', objectId: '0xmeta', metadataCapState: 'CLAIMED' }));
    const { row } = await registerAsset(db, claimed, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW });
    expect(row.metadataCapState).toBe('CLAIMED');
    expect(getAsset(db, 'e1', SUI_LONG)!.metadataCapState).toBe('CLAIMED');
  });

  it('throws on an illegal metadataCapState — never silently writes null', async () => {
    // WHY: the fetcher boundary is the same one a real grpc adapter crosses. An unrecognised
    // cap state is a value we refuse to interpret; coercing it to null would forge a "cap state
    // unknown" verdict the source never gave. It must fail loud (COIN_METADATA_INVALID_CAP_STATE),
    // and — mutation check — this red must come from registerAsset's assert, not the DB CHECK:
    // a `?? null` shortcut lets the raw string through and the SqliteError, not our code, throws.
    const db = freshDb();
    const bogus = fetcherOf(async () => ({ decimals: 9, symbol: 'SUI', name: 'Sui', objectId: '0xmeta', metadataCapState: 'HACKED' }));
    await expect(registerAsset(db, bogus, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'COIN_METADATA_INVALID_CAP_STATE' });
    expect(getAsset(db, 'e1', SUI_LONG)).toBeNull();
  });

  it('is idempotent — re-registering the same decimals returns 200', async () => {
    const db = freshDb();
    await registerAsset(db, chainHit, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW });
    const { status } = await registerAsset(db, chainHit, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW });
    expect(status).toBe(200);
  });

  it('409s when the client claims a decimals the chain contradicts — chain wins', async () => {
    const db = freshDb();
    await expect(registerAsset(db, chainHit, { entityId: 'e1', coinType: SUI, decimals: 6, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'CHAIN_DECIMALS_MISMATCH', status: 409 });
    const log = db.prepare(`SELECT claimed_decimals, chain_decimals FROM asset_registry_log`).get() as Record<string, number>;
    expect(log).toEqual(expect.objectContaining({ claimed_decimals: 6, chain_decimals: 9 }));
  });

  it('409s when the asset is already registered with different decimals — never UPDATEs', async () => {
    const db = freshDb();
    insertAssetIfAbsent(db, { entityId: 'e1', coinType: SUI_LONG, decimals: 6, symbol: 'S', displayName: 'S',
      source: 'manual', chainObjectId: null, metadataCapState: null, fetchedAt: null,
      decidedBy: 'a', reason: REASON, createdAt: NOW });
    await expect(registerAsset(db, chainHit, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'ASSET_DECIMALS_CONFLICT', status: 409 });
    expect(getAsset(db, 'e1', SUI_LONG)!.decimals).toBe(6);
  });
});

describe('registerAsset — the SDK traps (V1, V6)', () => {
  it('a transport error is 503, NOT a manual-declaration prompt', async () => {
    // WHY (V6): the SDK's bare catch (grpc/core.mjs:152-153) returns {coinMetadata:null} for
    // BOTH "no metadata" and "network died". If a blip routed us into the manual branch, D7's
    // immutability would permanently downgrade a chain-verifiable asset to source='manual'.
    const db = freshDb();
    await expect(registerAsset(db, unreachable, { entityId: 'e1', coinType: SUI, decimals: 9, symbol: 'SUI', reason: REASON, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE', status: 503 });
    expect(getAsset(db, 'e1', SUI_LONG)).toBeNull();
  });

  it('metadata present but decimals absent must NOT become 0', async () => {
    // WHY (V1): getCoinMetadata does `decimals: response.metadata.decimals ?? 0`
    // (grpc/core.mjs:158) behind a required-number type. 0 passes every range check and is
    // indistinguishable from a legitimate 0-decimal coin. We read the raw proto instead.
    const db = freshDb();
    await expect(registerAsset(db, metadataWithoutDecimals, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'MANUAL_DECIMALS_REQUIRED', status: 400 });
    expect(getAsset(db, 'e1', SUI_LONG)).toBeNull();
  });

  it('rejects an out-of-range decimals coming back from the chain', async () => {
    const db = freshDb();
    const bad = fetcherOf(async () => ({ decimals: 99, symbol: 'X', name: 'X' }));
    await expect(registerAsset(db, bad, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'COIN_METADATA_INVALID_DECIMALS' });
  });
});

// The grpc adapter is the ONE boundary the 500+ fetcher-injecting tests above never cross — and
// it is exactly where "no metadata" vs "transport error" get conflated. Verified live (testnet,
// scripts/spike-coin-info.ts, 2026-07-10): a non-existent coin makes getCoinInfo THROW an RpcError
// with .code==='NOT_FOUND', it does NOT resolve an empty response. So these drive the real
// makeGrpcCoinInfoFetcher with a fake grpc that reproduces that shape.
function rpcError(code: string, message = 'boom'): Error {
  const e = new Error(message); e.name = 'RpcError'; (e as { code?: unknown }).code = code; return e;
}
function grpcThrowing(err: unknown): SuiGrpcClient {
  return { stateService: { getCoinInfo: async () => { throw err; } } } as unknown as SuiGrpcClient;
}

describe('makeGrpcCoinInfoFetcher — the boundary every other test skips', () => {
  it('a NOT_FOUND coin resolves null → registerAsset takes the MANUAL branch (not 503)', async () => {
    // WHY (Finding 1): NOT_FOUND is the ONLY path that reaches manual registration in production.
    // The original catch rethrew everything as ChainUnreachableError, so 503 shadowed manual and
    // manual — the whole reason the table tolerates metadata-less coins — was dead code. This must
    // land on 400 MANUAL_DECIMALS_REQUIRED (chain said "no metadata", operator supplied nothing),
    // NOT 503.
    const db = freshDb();
    const fetcher = makeGrpcCoinInfoFetcher(grpcThrowing(rpcError('NOT_FOUND')), 15000);
    await expect(registerAsset(db, fetcher, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'MANUAL_DECIMALS_REQUIRED', status: 400 });
    expect(getAsset(db, 'e1', SUI_LONG)).toBeNull();
  });

  it('a NOT_FOUND coin with full manual args registers as source=manual', async () => {
    // WHY: proves null→manual is actually usable end-to-end, not merely a different error code.
    const db = freshDb();
    const fetcher = makeGrpcCoinInfoFetcher(grpcThrowing(rpcError('NOT_FOUND')), 15000);
    const { status, row } = await registerAsset(db, fetcher,
      { entityId: 'e1', coinType: SUI, decimals: 6, symbol: 'FAKE', reason: REASON, actor: 'a', now: NOW });
    expect(status).toBe(201);
    expect(row.source).toBe('manual');
  });

  for (const code of ['UNAVAILABLE', 'DEADLINE_EXCEEDED']) {
    it(`a ${code} RpcError is 503 CHAIN_UNREACHABLE with zero DB rows`, async () => {
      // WHY (Finding 1): a transport failure must NEVER be read as "no metadata" — that would
      // permanently downgrade a chain-verifiable asset to source='manual' (D7: decimals never UPDATE).
      const db = freshDb();
      const fetcher = makeGrpcCoinInfoFetcher(grpcThrowing(rpcError(code)), 15000);
      await expect(registerAsset(db, fetcher, { entityId: 'e1', coinType: SUI, decimals: 9, symbol: 'SUI', reason: REASON, actor: 'a', now: NOW }))
        .rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE', status: 503 });
      expect(getAsset(db, 'e1', SUI_LONG)).toBeNull();
    });
  }

  it('an UNRECOGNISED error (not an RpcError, no known code) is 503 — allow-list, never deny-list', async () => {
    // WHY (Finding 1, the mutation guard): this is the case a deny-list ("anything that isn't
    // UNAVAILABLE → null") leaks through. A plain Error we cannot classify MUST be treated as
    // unreachable, not silently accepted as "no metadata". If this ever goes green under a deny-list
    // rewrite, the classifier is fabricating a manual downgrade from an error it never understood.
    const db = freshDb();
    const fetcher = makeGrpcCoinInfoFetcher(grpcThrowing(new Error('who knows')), 15000);
    await expect(registerAsset(db, fetcher, { entityId: 'e1', coinType: SUI, decimals: 9, symbol: 'SUI', reason: REASON, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE', status: 503 });
    expect(getAsset(db, 'e1', SUI_LONG)).toBeNull();
  });

  it('a NOT_FOUND-code error whose name is NOT RpcError is still 503 (shape, not just code)', async () => {
    // WHY: the allow-list requires BOTH name==='RpcError' AND code==='NOT_FOUND'. A stray object
    // carrying code:'NOT_FOUND' but not the RpcError shape must not sneak into the manual branch.
    const db = freshDb();
    const rogue = new Error('nope'); (rogue as { code?: unknown }).code = 'NOT_FOUND'; // name stays 'Error'
    const fetcher = makeGrpcCoinInfoFetcher(grpcThrowing(rogue), 15000);
    await expect(registerAsset(db, fetcher, { entityId: 'e1', coinType: SUI, decimals: 9, symbol: 'SUI', reason: REASON, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE', status: 503 });
  });
});

describe('registerAsset — manual path', () => {
  it('registers manually when the chain has no metadata', async () => {
    const db = freshDb();
    const { row } = await registerAsset(db, noMetadata,
      { entityId: 'e1', coinType: SUI, decimals: 6, symbol: 'FAKE', reason: REASON, actor: 'demo-controller', now: NOW });
    expect(row.source).toBe('manual');
    expect(row.decidedBy).toBe('demo-controller');
    expect(row.chainObjectId).toBeNull();
  });

  it('requires decimals, symbol and reason', async () => {
    const db = freshDb();
    for (const args of [
      { symbol: 'F', reason: REASON },
      { decimals: 6, reason: REASON },
      { decimals: 6, symbol: 'F' },
    ]) {
      await expect(registerAsset(db, noMetadata, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW, ...args }))
        .rejects.toMatchObject({ code: 'MANUAL_DECIMALS_REQUIRED' });
    }
  });

  it('rejects a placeholder reason', async () => {
    // WHY: an auditor needs a justification, not "n/a".
    const db = freshDb();
    await expect(registerAsset(db, noMetadata, { entityId: 'e1', coinType: SUI, decimals: 6, symbol: 'F', reason: 'n/a', actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'MANUAL_DECIMALS_REQUIRED' });
  });

  it('never trusts a client-supplied decidedBy', async () => {
    const db = freshDb();
    const { row } = await registerAsset(db, noMetadata,
      { entityId: 'e1', coinType: SUI, decimals: 6, symbol: 'F', reason: REASON, actor: 'server-const', now: NOW });
    expect(row.decidedBy).toBe('server-const');
  });
});

describe('registerAsset — coinType validation', () => {
  it('rejects a named package before touching the network', async () => {
    const db = freshDb();
    let called = false;
    const spy = fetcherOf(async () => { called = true; return null; });
    await expect(registerAsset(db, spy, { entityId: 'e1', coinType: 'app@org::t::T', actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'NAMED_PACKAGE_UNSUPPORTED', status: 400 });
    // WHY (V5): format validation is local and must gate the outbound RPC.
    expect(called).toBe(false);
  });

  it('rejects a malformed coinType before touching the network', async () => {
    const db = freshDb();
    let called = false;
    const spy = fetcherOf(async () => { called = true; return null; });
    await expect(registerAsset(db, spy, { entityId: 'e1', coinType: 'garbage', actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'INVALID_COIN_TYPE', status: 400 });
    expect(called).toBe(false);
  });
});

describe('correctAsset — zero blast radius only (D7b)', () => {
  function seedRegistered(db: ReturnType<typeof freshDb>) {
    insertAssetIfAbsent(db, { entityId: 'e1', coinType: SUI_LONG, decimals: 6, symbol: 'S', displayName: 'S',
      source: 'manual', chainObjectId: null, metadataCapState: null, fetchedAt: null,
      decidedBy: 'a', reason: REASON, createdAt: NOW });
  }

  it('deletes an unused registration and logs it as corrected', () => {
    const db = freshDb(); seedRegistered(db);
    correctAsset(db, 'e1', SUI, 'demo-controller', NOW);
    expect(getAsset(db, 'e1', SUI_LONG)).toBeNull();
    const log = db.prepare(`SELECT outcome FROM asset_registry_log`).get() as { outcome: string };
    expect(log.outcome).toBe('corrected');
  });

  it('refuses when an event references the coinType', () => {
    const db = freshDb(); seedRegistered(db);
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1',?,'POSTED')`)
      .run(JSON.stringify({ coinType: SUI_LONG }));
    expect(() => correctAsset(db, 'e1', SUI, 'a', NOW)).toThrow(/ASSET_IN_USE/);
    expect(getAsset(db, 'e1', SUI_LONG)).not.toBeNull();
  });

  it('refuses when a journal entry references the coinType', () => {
    const db = freshDb(); seedRegistered(db);
    // journal_entries.event_id has a NOT NULL FK to events(id); seed the parent event first.
    // Its payload references NO coinType, so usage is driven purely by the JE below — this is
    // the JE-references-coinType case, not the event-references one.
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1','{}','POSTED')`).run();
    db.prepare(`INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash)
                VALUES ('je1','e1','ev1',?, 'k1','h1')`).run(JSON.stringify({ lines: [{ origCoinType: SUI_LONG }] }));
    expect(() => correctAsset(db, 'e1', SUI, 'a', NOW)).toThrow(/ASSET_IN_USE/);
  });

  it('refuses when the asset is unregistered', () => {
    expect(() => correctAsset(freshDb(), 'e1', SUI, 'a', NOW)).toThrow(/ASSET_NOT_REGISTERED/);
  });
});
