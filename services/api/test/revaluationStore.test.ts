import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import {
  insertRun, latestRun, insertValuation, supersedeValuationsOfRun,
  foldValuationStates, lotSetHash, pnlBuckets, RevaluationDataError,
} from '../src/store/revaluationStore.js';

function mkDb(): Db {
  const db = openDb(':memory:');
  insertEntity(db, { id: 'e1', displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  return db;
}

const runRow = (over: Partial<Parameters<typeof insertRun>[1]> = {}) => ({
  entityId: 'e1', periodId: '2026-Q2', priceSetHash: 'ph1', lotSetHash: 'lh1',
  policySetVersion: 'ps-1', accountingStandard: 'GAAP', reversalOfRunId: null, ...over,
});

const valRow = (runId: string, over: Partial<Parameters<typeof insertValuation>[1]> = {}) => ({
  entityId: 'e1', lotId: 'lot-1', periodId: '2026-Q2', runId, seq: 1, basis: 'GAAP_FV',
  qtyMinor: '1000', priorCarryingMinor: '500', currentValueMinor: '600', deltaMinor: '100',
  pricePointId: null, jeId: null, reason: 'REVALUE', policySetVersion: 'ps-1', supersededBy: null, ...over,
});

describe('revaluation_run store', () => {
  let db: Db;
  beforeEach(() => { db = mkDb(); });

  it('insertRun assigns monotonic seq per (entity, period): 1, then 2', () => {
    const r1 = insertRun(db, runRow());
    const r2 = insertRun(db, runRow());
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);
  });

  it('insertRun seq is scoped per period — a different period restarts at 1', () => {
    const r1 = insertRun(db, runRow());
    const r2 = insertRun(db, runRow({ periodId: '2026-Q3' }));
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(1);
  });

  it('latestRun returns the highest-seq run, null when none exist', () => {
    expect(latestRun(db, 'e1', '2026-Q2')).toBeNull();
    insertRun(db, runRow());
    const r2 = insertRun(db, runRow());
    const latest = latestRun(db, 'e1', '2026-Q2');
    expect(latest?.id).toBe(r2.id);
    expect(latest?.seq).toBe(2);
  });
});

describe('lot_valuation store: supersede excludes seq-0 (D6)', () => {
  let db: Db;
  beforeEach(() => { db = mkDb(); });

  it('supersedeValuationsOfRun only touches seq>0 rows; seq=0 stays superseded_by=NULL', () => {
    const run1 = insertRun(db, runRow());
    const run2 = insertRun(db, runRow());
    insertValuation(db, valRow(run1.id, { seq: 0, reason: 'OPENING_FV' }));
    insertValuation(db, valRow(run1.id, { seq: 1, reason: 'REVALUE' }));

    const n = supersedeValuationsOfRun(db, run1.id, run2.id);
    expect(n).toBe(1); // only the seq=1 row

    const rows = db.prepare('SELECT seq, superseded_by FROM lot_valuation WHERE run_id = ? ORDER BY seq').all(run1.id) as
      Array<{ seq: number; superseded_by: string | null }>;
    expect(rows[0]).toEqual({ seq: 0, superseded_by: null });
    expect(rows[1]).toEqual({ seq: 1, superseded_by: run2.id });
  });

  // MUTATION GUARD: if the `WHERE seq > 0` clause in supersedeValuationsOfRun is dropped,
  // this assertion goes red — the seq=0 opening row would get superseded_by set, and
  // foldValuationStates would then report hasOpeningSeq0=false for a lot that DOES have
  // an opening baseline. This test must fail if that guard is removed.
  it('mutation guard: seq=0 row must never receive a non-null superseded_by', () => {
    const run1 = insertRun(db, runRow());
    const run2 = insertRun(db, runRow());
    insertValuation(db, valRow(run1.id, { seq: 0, reason: 'OPENING_FV' }));
    supersedeValuationsOfRun(db, run1.id, run2.id);
    const opening = db.prepare('SELECT superseded_by FROM lot_valuation WHERE run_id = ? AND seq = 0').get(run1.id) as
      { superseded_by: string | null };
    expect(opening.superseded_by).toBeNull();
  });
});

describe('foldValuationStates', () => {
  let db: Db;
  beforeEach(() => { db = mkDb(); });

  it('sums delta across reasons, tracks impairment IMPAIR-adds/REVERSE-subtracts, flags hasOpeningSeq0', () => {
    const run1 = insertRun(db, runRow());
    insertValuation(db, valRow(run1.id, { seq: 0, reason: 'OPENING_FV', deltaMinor: '0', qtyMinor: '1000' }));
    insertValuation(db, valRow(run1.id, { seq: 1, reason: 'IMPAIR', deltaMinor: '-50', qtyMinor: '1000' }));
    const run2 = insertRun(db, runRow());
    insertValuation(db, valRow(run2.id, { seq: 2, reason: 'REVERSE', deltaMinor: '20', qtyMinor: '900' }));

    const states = foldValuationStates(db, 'e1', ['lot-1'], 'GAAP_FV');
    const s = states['lot-1']!;
    expect(s.cumulativeDeltaMinor).toBe((0 - 50 + 20).toString()); // -30
    expect(s.cumulativeImpairmentMinor).toBe((50 - 20).toString()); // 30
    expect(s.qtyAtLastValuationMinor).toBe('900'); // latest (highest seq) row
    expect(s.hasOpeningSeq0).toBe(true);
  });

  it('excludes superseded rows from the fold', () => {
    const run1 = insertRun(db, runRow());
    insertValuation(db, valRow(run1.id, { seq: 1, reason: 'REVALUE', deltaMinor: '100' }));
    const run2 = insertRun(db, runRow());
    supersedeValuationsOfRun(db, run1.id, run2.id);
    insertValuation(db, valRow(run2.id, { seq: 2, reason: 'REVALUE', deltaMinor: '5' }));

    const states = foldValuationStates(db, 'e1', ['lot-1'], 'GAAP_FV');
    expect(states['lot-1']!.cumulativeDeltaMinor).toBe('5'); // only the non-superseded row
  });

  it('a lot with no rows is simply absent from the result (zero-state, per RevalueInput contract)', () => {
    const states = foldValuationStates(db, 'e1', ['nonexistent-lot'], 'GAAP_FV');
    expect(states['nonexistent-lot']).toBeUndefined();
  });

  it('cumulativeImpairment going negative (REVERSE > IMPAIR) throws VALUATION_CORRUPT', () => {
    const run1 = insertRun(db, runRow());
    insertValuation(db, valRow(run1.id, { seq: 1, reason: 'IMPAIR', deltaMinor: '-10' }));
    insertValuation(db, valRow(run1.id, { seq: 2, reason: 'REVERSE', deltaMinor: '999' }));
    expect(() => foldValuationStates(db, 'e1', ['lot-1'], 'GAAP_FV')).toThrow(RevaluationDataError);
    try {
      foldValuationStates(db, 'e1', ['lot-1'], 'GAAP_FV');
    } catch (e) {
      expect((e as RevaluationDataError).code).toBe('VALUATION_CORRUPT');
    }
  });
});

describe('foldValuationStates monkey tests: hostile rows must fail loud, never silently fold', () => {
  let db: Db;
  let run1: ReturnType<typeof insertRun>;
  beforeEach(() => {
    db = mkDb();
    run1 = insertRun(db, runRow());
  });

  function rawInsert(over: Record<string, unknown> = {}): void {
    const base = {
      id: `lv-raw-${Math.random()}`, entity_id: 'e1', lot_id: 'lot-1', period_id: '2026-Q2',
      run_id: run1.id, seq: 1, basis: 'GAAP_FV', qty_minor: '1000', prior_carrying_minor: '500',
      current_value_minor: '600', delta_minor: '100', price_point_id: null, je_id: null,
      reason: 'REVALUE', policy_set_version: 'ps-1', superseded_by: null, created_at: new Date().toISOString(),
      ...over,
    };
    db.prepare(
      `INSERT INTO lot_valuation (id, entity_id, lot_id, period_id, run_id, seq, basis, qty_minor,
         prior_carrying_minor, current_value_minor, delta_minor, price_point_id, je_id, reason,
         policy_set_version, superseded_by, created_at)
       VALUES (@id, @entity_id, @lot_id, @period_id, @run_id, @seq, @basis, @qty_minor, @prior_carrying_minor,
         @current_value_minor, @delta_minor, @price_point_id, @je_id, @reason, @policy_set_version,
         @superseded_by, @created_at)`,
    ).run(base);
  }

  it('unknown basis (LIFO) mismatching expectedBasis throws VALUATION_CORRUPT', () => {
    rawInsert({ basis: 'LIFO' });
    expect(() => foldValuationStates(db, 'e1', ['lot-1'], 'GAAP_FV')).toThrow(RevaluationDataError);
  });

  it('unknown reason (empty string) throws VALUATION_CORRUPT', () => {
    rawInsert({ reason: '' });
    expect(() => foldValuationStates(db, 'e1', ['lot-1'], 'GAAP_FV')).toThrow(RevaluationDataError);
  });

  it('negative qty_minor throws VALUATION_CORRUPT', () => {
    rawInsert({ qty_minor: '-1' });
    expect(() => foldValuationStates(db, 'e1', ['lot-1'], 'GAAP_FV')).toThrow(RevaluationDataError);
  });

  it('orphan run_id (references a nonexistent revaluation_run) throws VALUATION_CORRUPT', () => {
    // The schema's FK would normally block this at insert time — bypass it here to simulate
    // a row that reached the table through some other path (legacy migration, manual repair)
    // and verify the READ side (foldValuationStates) also fails loud, independent of the FK.
    db.pragma('foreign_keys = OFF');
    rawInsert({ run_id: 'rv-does-not-exist' });
    db.pragma('foreign_keys = ON');
    expect(() => foldValuationStates(db, 'e1', ['lot-1'], 'GAAP_FV')).toThrow(RevaluationDataError);
  });

  it('a GAAP_COST row read into an IFRS reversal fold (mixed basis) throws VALUATION_CORRUPT — CPA B2', () => {
    rawInsert({ basis: 'GAAP_COST' });
    expect(() => foldValuationStates(db, 'e1', ['lot-1'], 'IFRS_COST')).toThrow(RevaluationDataError);
  });
});

describe('lotSetHash', () => {
  it('is stable regardless of input order (sorted before hashing)', () => {
    const lotsA: Parameters<typeof lotSetHash>[0] = [
      { lotId: 'b', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xw', remainingQtyMinor: '200', costMinor: '100' },
      { lotId: 'a', seq: 2, coinType: '0x2::sui::SUI', wallet: '0xw', remainingQtyMinor: '100', costMinor: '50' },
    ];
    const lotsB = [lotsA[1]!, lotsA[0]!];
    expect(lotSetHash(lotsA)).toBe(lotSetHash(lotsB));
  });

  it('changes when a lot quantity changes', () => {
    const lots1: Parameters<typeof lotSetHash>[0] = [
      { lotId: 'a', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xw', remainingQtyMinor: '100', costMinor: '50' },
    ];
    const lots2: Parameters<typeof lotSetHash>[0] = [
      { lotId: 'a', seq: 1, coinType: '0x2::sui::SUI', wallet: '0xw', remainingQtyMinor: '999', costMinor: '50' },
    ];
    expect(lotSetHash(lots1)).not.toBe(lotSetHash(lots2));
  });
});

// Ledger follow-up (pre-TB): pnlBuckets is the single source for the realized/unrealized
// presentation split. Two semantics must hold (see revaluation.splitAfterRerun.test.ts for the
// end-to-end sequence that broke the old proration):
//   1. EXACT SUM — live REVALUE deltas plus DISPOSAL_RELEASE rows' stored pnl_delta_minor,
//      immune to which OTHER rows (opening, superseded revals) surround them.
//   2. LEGACY FALLBACK — a release row with NULL pnl_delta_minor (written before the column
//      existed) is attributed by the old proportional ratio against live REVALUE/OPENING sums.
describe('pnlBuckets: exact P&L bucket per lot', () => {
  let db: Db;
  beforeEach(() => { db = mkDb(); });

  it('sums live REVALUE deltas and stored release pnl shares; opening delta excluded; superseded REVALUE excluded', () => {
    const run1 = insertRun(db, runRow());
    const run2 = insertRun(db, runRow());
    insertValuation(db, valRow(run1.id, { seq: 0, reason: 'OPENING_FV', deltaMinor: '20000' }));
    insertValuation(db, valRow(run1.id, { seq: 1, reason: 'REVALUE', deltaMinor: '20000' }));
    // Disposal released -20000 total, of which -10000 was the P&L share (stored).
    insertValuation(db, valRow(run1.id, { seq: 1, reason: 'DISPOSAL_RELEASE', deltaMinor: '-20000', pnlDeltaMinor: '-10000' }), 'evt-1');
    // Rerun: old REVALUE superseded (release survives), fresh REVALUE +30000 under run2.
    supersedeValuationsOfRun(db, run1.id, run2.id);
    insertValuation(db, valRow(run2.id, { seq: 2, reason: 'REVALUE', deltaMinor: '30000' }));

    // Live rows: opening +20000 (not P&L), release pnl −10000, new REVALUE +30000 → bucket 20000.
    // The broken proration read 18000 here (30000 * 30000 / 50000).
    expect(pnlBuckets(db, 'e1', ['lot-1'])).toEqual({ 'lot-1': '20000' });
  });

  it('legacy release row (NULL pnl_delta_minor) falls back to proportional attribution against live raw sums', () => {
    const run1 = insertRun(db, runRow());
    insertValuation(db, valRow(run1.id, { seq: 0, reason: 'OPENING_FV', deltaMinor: '20000' }));
    insertValuation(db, valRow(run1.id, { seq: 1, reason: 'REVALUE', deltaMinor: '20000' }));
    insertValuation(db, valRow(run1.id, { seq: 1, reason: 'DISPOSAL_RELEASE', deltaMinor: '-20000' }), 'evt-1'); // pnlDeltaMinor omitted -> NULL

    // Old-formula equivalence: pnl 20000 + (-20000 * 20000 / 40000) = 10000.
    expect(pnlBuckets(db, 'e1', ['lot-1'])).toEqual({ 'lot-1': '10000' });
  });

  it('lot with no valuation rows is simply absent from the result', () => {
    expect(pnlBuckets(db, 'e1', ['lot-none'])).toEqual({});
  });
});
