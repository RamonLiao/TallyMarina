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

// External review (should-fix): period <-> cut-off-date is a pure calendar computation
// (a "YYYY-Qn" id has exactly one start date and one end date), so it must never live in a
// hard-coded table — a table only covers the periods someone remembered to add a row for,
// and every other period throws, permanently blocking close/cockpit for it with no fix but a
// code change. Quarter-end day counts are fixed regardless of leap year (quarter-end months
// are always 3/6/9/12, none of which is February), so no leap-year handling is needed.
// Format is still validated and fails loud (`^YYYY-Qn$` only) — this only replaces the TABLE
// LOOKUP, not the fail-closed behavior for a malformed/unknown-shaped period id.
const QUARTER_END_DAY: Readonly<Record<'1' | '2' | '3' | '4', string>> = {
  '1': '03-31', '2': '06-30', '3': '09-30', '4': '12-31',
};

function parsePeriodId(periodId: string): { year: string; quarter: '1' | '2' | '3' | '4' } {
  const match = /^(\d{4})-Q([1-4])$/.exec(periodId);
  if (!match) throw new Error(`periodCutoff: unknown period ${periodId}`);
  return { year: match[1]!, quarter: match[2] as '1' | '2' | '3' | '4' };
}

export function periodCutoff(periodId: string): string {
  const { year, quarter } = parsePeriodId(periodId);
  return `${year}-${QUARTER_END_DAY[quarter]}`;
}

export function cutoffPeriod(asOf: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (match) {
    const [, year, month, day] = match as unknown as [string, string, string, string];
    const quarter = (Object.entries(QUARTER_END_DAY) as Array<['1' | '2' | '3' | '4', string]>)
      .find(([, md]) => md === `${month}-${day}`)?.[0];
    if (quarter) return `${year}-Q${quarter}`;
  }
  throw new Error(`cutoffPeriod: ${asOf} is not a known period cut-off date`);
}

// Quarter start date for a "YYYY-Qn" period id — the first day of the quarter's first month.
function periodStart(periodId: string): string {
  const { year, quarter } = parsePeriodId(periodId);
  const startMonth = (Number(quarter) - 1) * 3 + 1;
  return `${year}-${String(startMonth).padStart(2, '0')}-01`;
}

// spec v2.3: as_of no longer needs to land exactly on a period cut-off date — any date
// within the period's [start, cutoff] range resolves to that period. Unbricks event-day
// pricing (e.g. a mid-period payment) while still rejecting dates that don't parse or fall
// within a supported year range... actually: any well-formed date resolves to its calendar
// quarter (computation, not a lookup table), so this only throws on a malformed date string.
export function periodOfDate(asOf: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (!match) throw new Error(`periodOfDate: ${asOf} is not within any known period`);
  const [, year, month, day] = match as unknown as [string, string, string, string];
  // F3 (dual-review minor): the regex accepts shape, not calendar — '2026-02-31' would land in
  // Q1 and persist a price no cut-off can ever reference. Round-trip through Date (UTC) to
  // reject non-existent days (Date normalizes 02-31 to 03-03, so the components won't match).
  const dt = new Date(`${asOf}T00:00:00Z`);
  if (dt.getUTCFullYear() !== Number(year) || dt.getUTCMonth() + 1 !== Number(month) || dt.getUTCDate() !== Number(day)) {
    throw new Error(`periodOfDate: ${asOf} is not a real calendar date`);
  }
  const quarter = Math.floor((Number(month) - 1) / 3) + 1;
  const periodId = `${year}-Q${quarter}`;
  const start = periodStart(periodId);
  const cutoff = periodCutoff(periodId);
  if (asOf >= start && asOf <= cutoff) return periodId;
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
