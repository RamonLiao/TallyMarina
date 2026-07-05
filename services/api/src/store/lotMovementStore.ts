// GUARDRAIL: nothing under src/ai/ may import this module (same rule as journalStore).
import type { Db } from './db.js';
import type { PositionLot } from '../deps/rulesEngine.js';

export interface LotMovementRow {
  id: string; entityId: string; eventId: string; jeId: string | null;
  lotId: string; lotSeq: string; periodId: string; coinType: string; wallet: string;
  deltaQtyMinor: string; deltaCostMinor: string;
  costBasisMethod: string; policySetVersion: string; idempotencyKey: string;
}

export function insertLotMovement(db: Db, r: LotMovementRow): 'inserted' | 'duplicate' {
  // INSERT OR IGNORE mirrors insertJournalEntry: DB-level serialization, no TOCTOU.
  const result = db.prepare(
    `INSERT OR IGNORE INTO lot_movement (id, entity_id, event_id, je_id, lot_id, lot_seq, period_id,
       coin_type, wallet, delta_qty_minor, delta_cost_minor, cost_basis_method, policy_set_version, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.id, r.entityId, r.eventId, r.jeId, r.lotId, r.lotSeq, r.periodId,
    r.coinType, r.wallet, r.deltaQtyMinor, r.deltaCostMinor, r.costBasisMethod, r.policySetVersion, r.idempotencyKey);
  return result.changes > 0 ? 'inserted' : 'duplicate';
}

export function listLotMovements(db: Db, entityId: string, f: { wallet?: string; coinType?: string; periodId?: string } = {}): LotMovementRow[] {
  const conds = ['entity_id = ?']; const args: unknown[] = [entityId];
  if (f.wallet) { conds.push('wallet = ?'); args.push(f.wallet); }
  if (f.coinType) { conds.push('coin_type = ?'); args.push(f.coinType); }
  if (f.periodId) { conds.push('period_id = ?'); args.push(f.periodId); }
  const rows = db.prepare(`SELECT * FROM lot_movement WHERE ${conds.join(' AND ')} ORDER BY lot_seq, id`).all(...args) as Record<string, unknown>[];
  return rows.map(fromRow);
}

export function foldRemainingLots(db: Db, entityId: string, wallet: string, coinType: string): PositionLot[] {
  const moves = listLotMovements(db, entityId, { wallet, coinType });
  const byLot = new Map<string, { lotSeq: string; qty: bigint; cost: bigint }>();
  for (const m of moves) {
    const cur = byLot.get(m.lotId) ?? { lotSeq: m.lotSeq, qty: 0n, cost: 0n };
    // acquire row defines the lot's FIFO key; keep the smallest lot_seq seen (acquire precedes consumes)
    if (m.lotSeq < cur.lotSeq) cur.lotSeq = m.lotSeq;
    cur.qty += BigInt(m.deltaQtyMinor);
    cur.cost += BigInt(m.deltaCostMinor);
    byLot.set(m.lotId, cur);
  }
  for (const [lotId, v] of byLot) {
    if (v.qty < 0n || v.cost < 0n) throw new Error(`foldRemainingLots: negative remaining for ${lotId} (qty ${v.qty}, cost ${v.cost}) — ledger corrupted`);
    if (v.qty === 0n && v.cost !== 0n) throw new Error(`foldRemainingLots: cost leakage for ${lotId} (qty 0, cost ${v.cost}) — ledger corrupted`);
  }
  const lots = [...byLot.entries()]
    .filter(([, v]) => v.qty !== 0n)
    .sort(([, a], [, b]) => (a.lotSeq < b.lotSeq ? -1 : a.lotSeq > b.lotSeq ? 1 : 0));
  return lots.map(([lotId, v], i) => (
    { lotId, seq: i + 1, coinType, wallet, remainingQtyMinor: v.qty.toString(), costMinor: v.cost.toString() }
  ));
}

export function acquireLotSeq(db: Db, entityId: string, lotId: string): string {
  const r = db.prepare(
    `SELECT lot_seq FROM lot_movement WHERE entity_id = ? AND lot_id = ? AND delta_qty_minor NOT LIKE '-%' ORDER BY lot_seq LIMIT 1`,
  ).get(entityId, lotId) as { lot_seq: string } | undefined;
  if (!r) throw new Error(`acquireLotSeq: no acquire row for lot ${lotId}`);
  return r.lot_seq;
}

function fromRow(r: Record<string, unknown>): LotMovementRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, eventId: r.event_id as string,
    jeId: (r.je_id as string) ?? null, lotId: r.lot_id as string, lotSeq: r.lot_seq as string,
    periodId: r.period_id as string, coinType: r.coin_type as string, wallet: r.wallet as string,
    deltaQtyMinor: r.delta_qty_minor as string, deltaCostMinor: r.delta_cost_minor as string,
    costBasisMethod: r.cost_basis_method as string, policySetVersion: r.policy_set_version as string,
    idempotencyKey: r.idempotency_key as string,
  };
}
