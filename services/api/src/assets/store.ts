import type { Db } from '../store/db.js';
import { canonicalCoinType } from './normalize.js';

export type AssetSource = 'chain' | 'manual';
export type LogOutcome = 'registered' | 'conflict' | 'rejected' | 'corrected';
export type MetadataCapState = 'UNKNOWN' | 'CLAIMED' | 'UNCLAIMED' | 'DELETED';

export interface AssetRow {
  entityId: string; coinType: string; decimals: number;
  symbol: string; displayName: string; source: AssetSource;
  chainObjectId: string | null; metadataCapState: MetadataCapState | null; fetchedAt: string | null;
  decidedBy: string | null; reason: string | null; createdAt: string;
}

type DbAssetRow = {
  entity_id: string; coin_type: string; decimals: number; symbol: string; display_name: string;
  source: AssetSource; chain_object_id: string | null; metadata_cap_state: MetadataCapState | null;
  fetched_at: string | null; decided_by: string | null; reason: string | null; created_at: string;
};

function mapRow(r: DbAssetRow): AssetRow {
  return {
    entityId: r.entity_id, coinType: r.coin_type, decimals: r.decimals,
    symbol: r.symbol, displayName: r.display_name, source: r.source,
    chainObjectId: r.chain_object_id, metadataCapState: r.metadata_cap_state,
    fetchedAt: r.fetched_at, decidedBy: r.decided_by, reason: r.reason, createdAt: r.created_at,
  };
}

export function getAsset(db: Db, entityId: string, coinType: string): AssetRow | null {
  const r = db.prepare(`SELECT * FROM asset_registry WHERE entity_id=? AND coin_type=?`)
    .get(entityId, coinType) as DbAssetRow | undefined;
  return r ? mapRow(r) : null;
}

export function listAssets(db: Db, entityId: string): AssetRow[] {
  const rs = db.prepare(`SELECT * FROM asset_registry WHERE entity_id=? ORDER BY symbol, coin_type`)
    .all(entityId) as DbAssetRow[];
  return rs.map(mapRow);
}

/** Never UPDATEs (D7). The caller re-reads and 409s on a decimals divergence. */
export function insertAssetIfAbsent(db: Db, row: AssetRow): 'inserted' | 'exists' {
  const res = db.prepare(
    `INSERT INTO asset_registry
       (entity_id, coin_type, decimals, symbol, display_name, source,
        chain_object_id, metadata_cap_state, fetched_at, decided_by, reason, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (entity_id, coin_type) DO NOTHING`,
  ).run(row.entityId, row.coinType, row.decimals, row.symbol, row.displayName, row.source,
        row.chainObjectId, row.metadataCapState, row.fetchedAt, row.decidedBy, row.reason, row.createdAt);
  return res.changes === 1 ? 'inserted' : 'exists';
}

export function deleteAsset(db: Db, entityId: string, coinType: string): void {
  db.prepare(`DELETE FROM asset_registry WHERE entity_id=? AND coin_type=?`).run(entityId, coinType);
}

export function appendAssetLog(db: Db, row: {
  entityId: string; coinType: string; outcome: LogOutcome;
  decimals?: number | null; claimedDecimals?: number | null; chainDecimals?: number | null;
  source?: string | null; detail?: string | null; actor: string; at: string;
}): void {
  db.prepare(
    `INSERT INTO asset_registry_log
       (entity_id, coin_type, outcome, decimals, claimed_decimals, chain_decimals, source, detail, actor, at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(row.entityId, row.coinType, row.outcome, row.decimals ?? null,
        row.claimedDecimals ?? null, row.chainDecimals ?? null, row.source ?? null,
        row.detail ?? null, row.actor, row.at);
}

/**
 * Canonical coinTypes named by a payload.
 *
 * Returns null when the payload will not parse. A caller must read null as "this row might
 * reference anything" and fail closed — an unparseable event is not evidence of non-use.
 */
function coinTypesOf(json: string): Set<string> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v !== null && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if ((k === 'coinType' || k === 'origCoinType' || k === 'considerationAsset') && typeof val === 'string') {
          try { out.add(canonicalCoinType(val)); } catch { /* not a coin type — ignore */ }
        } else {
          visit(val);
        }
      }
    }
  };
  visit(parsed);
  return out;
}

/**
 * Gate for the correction endpoint (D7b). A coinType with zero events, zero JE lines and no
 * anchored snapshot has nothing downstream to restate, so a typo may be corrected outright.
 *
 * Comparison is on CANONICAL coinTypes, never on raw substrings. Payloads store whatever
 * spelling the sender used — the fixture writes '0x2::sui::SUI' — so a `LIKE '%<long form>%'`
 * probe misses the most common spelling entirely and reports zero usage for an asset that is
 * fully posted. That failure direction deletes master data for a live asset; it must not exist.
 *
 * Slower than SQL, and correctly so: correction is a rare, destructive operation.
 *
 * The `coinType` argument is canonicalized here, on entry — the same treatment the payload
 * side already gets in `coinTypesOf`. Do not rely on callers to pre-canonicalize: this
 * function is the sole gate in front of a delete, and a caller that forgets (or a future
 * second caller) would silently turn a live, posted asset into a false "unused" result.
 * A raw substring/equality compare here is the exact bug this function exists to prevent.
 *
 * If `coinType` cannot be canonicalized, `canonicalCoinType` throws `CoinTypeError` and this
 * function throws too, on purpose. This is the mirror-image tradeoff of `getAssetDecimals`
 * (a read path, returns null on a miss): a *destructive* gate must never turn "I can't tell"
 * into `{0,0,0}` ("safe to delete"). Failing loud on bad input is strictly safer than a
 * false negative here, which deletes registry master data for an asset that is still in use.
 */
export function countAssetUsage(db: Db, entityId: string, coinType: string): { events: number; jes: number; anchored: number } {
  const target = canonicalCoinType(coinType);
  const uses = (json: string): boolean => {
    const types = coinTypesOf(json);
    return types === null || types.has(target);   // unparseable => assume in use
  };

  const eventRows = db.prepare(`SELECT raw_json FROM events WHERE entity_id=?`).all(entityId) as { raw_json: string }[];
  const events = eventRows.filter((r) => uses(r.raw_json)).length;

  const jeRows = db.prepare(`SELECT je_json, period_id FROM journal_entries WHERE entity_id=?`)
    .all(entityId) as { je_json: string; period_id: string | null }[];
  const jes = jeRows.filter((r) => uses(r.je_json)).length;

  const anchoredPeriods = new Set(
    (db.prepare(`SELECT DISTINCT period_id FROM snapshots WHERE entity_id=? AND status='ANCHORED'`)
      .all(entityId) as { period_id: string }[]).map((r) => r.period_id),
  );
  const anchored = jeRows.filter((r) => r.period_id !== null && anchoredPeriods.has(r.period_id) && uses(r.je_json)).length;

  return { events, jes, anchored };
}
