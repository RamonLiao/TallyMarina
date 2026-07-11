// GUARDRAIL: read-only. This module replays events and MUST NOT write to the db.
import type { Db } from '../store/db.js';
import type { EventRow } from '../store/eventStore.js';
import type { NormalizedEvent, PositionLot } from '../deps/rulesEngine.js';
import { listByStatus } from '../store/eventStore.js';
import { evaluate } from '../deps/rulesEngine.js';
import { buildRuleInput } from '../http/buildRuleInput.js';
import { getActivePolicy, getActiveCoaMapping, toResolvedPolicySet, buildCoaMappingFromRules } from '../store/policyStore.js';

export interface SimLot { qtyMinor: string; costMinor: string; wallet: string; coinType: string; originEventId: string }
// gapPools: `${wallet}|${coinType}` keys whose replay hit a gap — recompute for any lot in
// that pool is partial (a consume/acquire never applied), so the DTO flags it as incomplete.
export interface SimulateResult { lots: Map<string, SimLot>; simulationGaps: string[]; gapPools: Set<string> }

interface PoolLot { qty: bigint; cost: bigint; wallet: string; coinType: string; seq: number; originEventId: string }

// Drift probe (spec §1): replay ALL POSTED events chronologically (eventTime asc) through
// evaluate with the CURRENT policy and periodOpen: true — even over locked periods; that IS
// the probe of "what would today's rules produce". An in-memory lot pool per (wallet,
// coinType) feeds each event's FIFO input. Non-POSTABLE (or a defensive throw) is recorded
// in simulationGaps and skipped — never thrown, never faked as a zero lot.
export function simulateLots(db: Db, entityId: string): SimulateResult {
  const posted = listByStatus(db, entityId, 'POSTED')
    .sort((a, b) => eventTimeOf(a).localeCompare(eventTimeOf(b)) || a.id.localeCompare(b.id));

  const pool = new Map<string, PoolLot>();
  const simulationGaps: string[] = [];
  const gapPools = new Set<string>();
  let nextSeq = 0;
  // Loaded ONCE per call (Task 3 read-path switchover) — the drift probe uses the CURRENT
  // active policy, never DEMO_POLICY_SET/DEMO_COA_RULES.
  const activePolicy = getActivePolicy(db, entityId);
  const activeCoa = getActiveCoaMapping(db, entityId);
  const enginePolicy = toResolvedPolicySet(activePolicy.doc, true);
  const engineCoa = buildCoaMappingFromRules(activeCoa.rules);

  for (const ev of posted) {
    const raw = JSON.parse(ev.rawJson) as NormalizedEvent;
    const lots: PositionLot[] = [...pool.entries()]
      .filter(([, l]) => l.wallet === raw.wallet && l.coinType === raw.coinType)
      .map(([lotId, l]) => ({ lotId, seq: l.seq, coinType: l.coinType, wallet: l.wallet, remainingQtyMinor: l.qty.toString(), costMinor: l.cost.toString() }));

    let output;
    try {
      output = evaluate(buildRuleInput(ev, { periodId: ev.periodId ?? raw.eventTime.slice(0, 4), periodOpen: true, lots, policySet: enginePolicy, coaMapping: engineCoa }));
    } catch {
      simulationGaps.push(ev.id); // a throw during replay is an honest gap, not a zero
      gapPools.add(`${raw.wallet}|${raw.coinType}`);
      continue;
    }
    if (output.decision !== 'POSTABLE') { simulationGaps.push(ev.id); gapPools.add(`${raw.wallet}|${raw.coinType}`); continue; }

    for (const m of output.lotMovements) {
      const cur = pool.get(m.lotId);
      if (cur) {
        cur.qty += BigInt(m.deltaQtyMinor);
        cur.cost += BigInt(m.deltaCostMinor);
      } else {
        pool.set(m.lotId, { qty: BigInt(m.deltaQtyMinor), cost: BigInt(m.deltaCostMinor), wallet: m.wallet, coinType: m.coinType, seq: nextSeq++, originEventId: ev.id });
      }
    }
  }

  const lots = new Map<string, SimLot>();
  for (const [lotId, l] of pool) {
    lots.set(lotId, { qtyMinor: l.qty.toString(), costMinor: l.cost.toString(), wallet: l.wallet, coinType: l.coinType, originEventId: l.originEventId });
  }
  return { lots, simulationGaps, gapPools };
}

function eventTimeOf(ev: EventRow): string {
  const t = (JSON.parse(ev.rawJson) as { eventTime?: unknown }).eventTime;
  if (typeof t !== 'string' || t.length === 0) throw new Error(`event ${ev.id} has no eventTime`);
  return t;
}
