// Task 4 (period-end revaluation, MVP manual price path): append-only price_points store.
// No UPDATE/DELETE path exists anywhere in this module — a re-entered price for the same
// (coin_type, as_of) is a NEW row; "current" is resolved at read time (latest by
// created_at, rowid tiebreak — SQLite's rowid strictly increases with insertion order on a
// TEXT PRIMARY KEY table, so it is a deterministic, race-free tiebreak within this process).
import { createHash } from 'node:crypto';
import type { Db } from './db.js';

export interface PricePointRow {
  id: string;
  entityId: string;
  coinType: string;
  asOf: string;
  priceMinor: string;
  quoteCurrency: string;
  principalMarket: string;
  source: string;
  level: string;
  createdAt: string;
}

// MVP hard-coded period ↔ cut-off-date table (spec §5). Deliberately a plain Record so a
// later period is a one-line addition, not a schema change. An unknown period/date is a
// caller bug (or an attempt to enter a price for a period this deployment doesn't know
// about) — fail loud rather than silently accepting an unbounded as-of date.
const PERIOD_CUTOFFS: Readonly<Record<string, string>> = {
  '2026-Q2': '2026-06-30',
};

export function periodCutoff(periodId: string): string {
  const cutoff = PERIOD_CUTOFFS[periodId];
  if (cutoff === undefined) {
    throw new Error(`periodCutoff: unknown period ${periodId}`);
  }
  return cutoff;
}

export function cutoffPeriod(asOf: string): string {
  for (const [periodId, cutoff] of Object.entries(PERIOD_CUTOFFS)) {
    if (cutoff === asOf) return periodId;
  }
  throw new Error(`cutoffPeriod: ${asOf} is not a known period cut-off date`);
}

// Quarter start date for a "YYYY-Qn" period id, derived from its cut-off (end) date rather
// than a second hard-coded table — one source of truth (PERIOD_CUTOFFS) for period bounds.
function periodStart(periodId: string, cutoff: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(periodId);
  if (!match) throw new Error(`periodStart: unsupported period id format ${periodId}`);
  const year = match[1];
  const quarter = Number(match[2]);
  const startMonth = (quarter - 1) * 3 + 1;
  void cutoff; // cutoff (end date) validated by caller via PERIOD_CUTOFFS lookup
  return `${year}-${String(startMonth).padStart(2, '0')}-01`;
}

// spec v2.3: as_of no longer needs to land exactly on a period cut-off date — any date
// within a known period's [start, cutoff] range resolves to that period. Unbricks event-day
// pricing (e.g. a mid-period payment) while still rejecting dates outside any known period.
export function periodOfDate(asOf: string): string {
  for (const [periodId, cutoff] of Object.entries(PERIOD_CUTOFFS)) {
    const start = periodStart(periodId, cutoff);
    if (asOf >= start && asOf <= cutoff) return periodId;
  }
  throw new Error(`periodOfDate: ${asOf} is not within any known period`);
}

function shortHash(coinType: string): string {
  return createHash('sha256').update(coinType).digest('hex').slice(0, 8);
}

export function insertPricePoint(db: Db, r: Omit<PricePointRow, 'id' | 'createdAt'>): PricePointRow {
  const countRow = db.prepare(
    'SELECT COUNT(*) AS n FROM price_points WHERE entity_id = ? AND coin_type = ? AND as_of = ?',
  ).get(r.entityId, r.coinType, r.asOf) as { n: number };
  const id = `px-${r.entityId}-${shortHash(r.coinType)}-${r.asOf}-${countRow.n + 1}`;
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO price_points
       (id, entity_id, coin_type, as_of, price_minor, quote_currency, principal_market, source, level, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, r.entityId, r.coinType, r.asOf, r.priceMinor, r.quoteCurrency, r.principalMarket, r.source, r.level, createdAt);
  return { ...r, id, createdAt };
}

// Fail-closed read-side bounds check: latestPricesAt is the canonical "current price"
// consumption path (Task 6/9 revaluation input). A price_minor that reached the table
// through anything other than insertPricePoint (e.g. a hand-crafted migration or a bug
// elsewhere) must never silently flow into a revaluation — throw instead of returning a
// bogus non-positive price as if it were real.
function assertSanePrice(row: PricePointRow): void {
  let minor: bigint;
  try {
    minor = BigInt(row.priceMinor);
  } catch {
    throw new Error(`latestPricesAt: price_points row ${row.id} has non-integer price_minor '${row.priceMinor}'`);
  }
  if (minor <= 0n) {
    throw new Error(`latestPricesAt: price_points row ${row.id} has non-positive price_minor '${row.priceMinor}'`);
  }
}

export function latestPricesAt(db: Db, entityId: string, asOf: string): PricePointRow[] {
  const rows = db.prepare(
    `SELECT * FROM price_points WHERE entity_id = ? AND as_of = ?
     ORDER BY coin_type ASC, created_at DESC, rowid DESC`,
  ).all(entityId, asOf) as Record<string, unknown>[];
  const latestByCoin = new Map<string, PricePointRow>();
  for (const raw of rows) {
    const row = fromRow(raw);
    if (!latestByCoin.has(row.coinType)) latestByCoin.set(row.coinType, row);
  }
  const result = [...latestByCoin.values()];
  for (const row of result) assertSanePrice(row);
  return result;
}

export function listPriceHistory(db: Db, entityId: string, coinType?: string): PricePointRow[] {
  const conds = ['entity_id = ?'];
  const args: unknown[] = [entityId];
  if (coinType) { conds.push('coin_type = ?'); args.push(coinType); }
  const rows = db.prepare(
    `SELECT * FROM price_points WHERE ${conds.join(' AND ')} ORDER BY created_at DESC, rowid DESC`,
  ).all(...args) as Record<string, unknown>[];
  return rows.map(fromRow);
}

// SUI S3 input domain = exactly the rows consumed by a revaluation run. Sorting by id
// before hashing makes the hash independent of read order (latestPricesAt's Map iteration
// order, DB scan order, etc.) — same set in, same hash out, regardless of how it arrived.
export function priceSetHash(rows: PricePointRow[]): string {
  const ids = rows.map((r) => r.id).sort();
  return createHash('sha256').update(ids.join('\n')).digest('hex');
}

function fromRow(r: Record<string, unknown>): PricePointRow {
  return {
    id: r.id as string,
    entityId: r.entity_id as string,
    coinType: r.coin_type as string,
    asOf: r.as_of as string,
    priceMinor: r.price_minor as string,
    quoteCurrency: r.quote_currency as string,
    principalMarket: r.principal_market as string,
    source: r.source as string,
    level: r.level as string,
    createdAt: r.created_at as string,
  };
}
