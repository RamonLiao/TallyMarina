import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent } from '../src/store/eventStore.js';
import { insertLotMovement, listLotMovements, foldRemainingLots, acquireLotSeq } from '../src/store/lotMovementStore.js';

function mkDb(): Db {
  const db = openDb(':memory:');
  insertEntity(db, { id: 'e1', displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  insertEvent(db, { id: 'ev1', entityId: 'e1', rawJson: JSON.stringify({ eventTime: '2026-01-01T00:00:00Z' }) });
  insertEvent(db, { id: 'ev2', entityId: 'e1', rawJson: JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }) });
  insertEvent(db, { id: 'ev3', entityId: 'e1', rawJson: JSON.stringify({ eventTime: '2026-03-01T00:00:00Z' }) });
  return db;
}

const row = (over: Partial<Parameters<typeof insertLotMovement>[1]> = {}) => ({
  id: 'lm-1', entityId: 'e1', eventId: 'ev1', jeId: null,
  lotId: 'OPEN-ev1', lotSeq: '2026-01-01T00:00:00Z|ev1', periodId: '2026-Q1',
  coinType: '0x2::sui::SUI', wallet: '0xw1',
  deltaQtyMinor: '1000', deltaCostMinor: '500',
  costBasisMethod: 'FIFO', policySetVersion: 'demo-ps-1', idempotencyKey: 'k1', ...over,
});

describe('lot_movement store', () => {
  let db: Db;
  beforeEach(() => { db = mkDb(); });

  it('true replay (same key, IDENTICAL payload) is a no-op (spec §6 #3)', () => {
    expect(insertLotMovement(db, row())).toBe('inserted');
    expect(insertLotMovement(db, row({ id: 'lm-1b' }))).toBe('duplicate'); // different PK, same economic payload
    expect(listLotMovements(db, 'e1')).toHaveLength(1); // second write did NOT alter the ledger
  });

  it('same key, DIFFERENT payload throws — silent-drop would diverge subledger from GL (fail-loud)', () => {
    expect(insertLotMovement(db, row())).toBe('inserted');
    expect(() => insertLotMovement(db, row({ id: 'lm-1b', deltaQtyMinor: '9999' }))).toThrow(/DIFFERENT payload/i);
    expect(listLotMovements(db, 'e1')).toHaveLength(1); // rejected write left the ledger untouched
  });

  it('fold: remaining = Σ signed deltas per lot; zero-remaining lots dropped', () => {
    insertLotMovement(db, row());                                                        // +1000/500
    insertLotMovement(db, row({ id: 'lm-2', idempotencyKey: 'k2', eventId: 'ev2', deltaQtyMinor: '-400', deltaCostMinor: '-200' }));
    const lots = foldRemainingLots(db, 'e1', '0xw1', '0x2::sui::SUI');
    expect(lots).toHaveLength(1);
    expect(lots[0]!.remainingQtyMinor).toBe('600');
    expect(lots[0]!.costMinor).toBe('300');
    // fully consume → disappears
    insertLotMovement(db, row({ id: 'lm-3', idempotencyKey: 'k3', eventId: 'ev3', deltaQtyMinor: '-600', deltaCostMinor: '-300' }));
    expect(foldRemainingLots(db, 'e1', '0xw1', '0x2::sui::SUI')).toHaveLength(0);
  });

  it('fold orders by lot_seq, NOT lot_id — cost basis depends on it (spec §2 / CPA C3)', () => {
    // lot_id order ('A-…' < 'Z-…') is the OPPOSITE of acquisition order here:
    insertLotMovement(db, row({ id: 'a', idempotencyKey: 'ka', lotId: 'Z-late-txdigest', lotSeq: '2026-01-01T00:00:00Z|ev1' }));
    insertLotMovement(db, row({ id: 'b', idempotencyKey: 'kb', eventId: 'ev2', lotId: 'A-early-txdigest', lotSeq: '2026-02-01T00:00:00Z|ev2' }));
    const lots = foldRemainingLots(db, 'e1', '0xw1', '0x2::sui::SUI');
    expect(lots.map((l) => l.lotId)).toEqual(['Z-late-txdigest', 'A-early-txdigest']); // chronological
    expect(lots.map((l) => l.seq)).toEqual([1, 2]); // engine contract: unique monotonic numbers
  });

  it('fold fail-loud on negative remaining (over-consumption = corrupted ledger, never clamp)', () => {
    insertLotMovement(db, row());
    insertLotMovement(db, row({ id: 'lm-2', idempotencyKey: 'k2', eventId: 'ev2', deltaQtyMinor: '-2000', deltaCostMinor: '-200' }));
    expect(() => foldRemainingLots(db, 'e1', '0xw1', '0x2::sui::SUI')).toThrow(/negative/i);
  });

  it('fold fail-loud on cost leakage: qty fully consumed (0) but residual cost != 0', () => {
    insertLotMovement(db, row());
    insertLotMovement(db, row({ id: 'lm-2', idempotencyKey: 'k2', eventId: 'ev2', deltaQtyMinor: '-1000', deltaCostMinor: '-499' }));
    expect(() => foldRemainingLots(db, 'e1', '0xw1', '0x2::sui::SUI')).toThrow(/leak/i);
  });

  it('acquireLotSeq returns the acquire row seq; throws for unknown lot (fail-loud)', () => {
    insertLotMovement(db, row());
    expect(acquireLotSeq(db, 'e1', 'OPEN-ev1')).toBe('2026-01-01T00:00:00Z|ev1');
    expect(() => acquireLotSeq(db, 'e1', 'ghost')).toThrow(/no acquire row/i);
  });
});
