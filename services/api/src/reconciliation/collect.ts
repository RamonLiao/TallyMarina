// services/api/src/reconciliation/collect.ts
// Recompute-on-read break aggregator (mirrors exceptions/collect.ts). NO writes.
// This is the close-gate enforcement source — never trusts client numbers.
import type { Db } from '../store/db.js';
import { loadReconFixture } from './fixture.js';
import { walletAssetMovements } from './movement.js';
import { getReconDisposition } from '../store/reconBreakStore.js';
import { blocksClose } from '../exceptions/disposition.js';


export interface ReconBreak {
  wallet: string; coinType: string; decimals: number;
  openingMinor: string; movementMinor: string; computedMinor: string;
  statementMinor: string; breakMinor: string; thresholdMinor: string;
  material: boolean;
  control: { debitMinor: string; creditMinor: string; legs: number };
}

function loadReconFixtureTolerant(entityId: string): import('./types.js').ReconFixtureRow[] {
  try {
    return loadReconFixture(entityId);
  } catch (e) {
    if (e instanceof Error && e.message === `no recon fixture for entity ${entityId}`) {
      return []; // missing = not configured; treat as empty (vacuously satisfied)
    }
    throw e; // malformed fixture — fail loud (Rule 12)
  }
}

export function collectBreaks(db: Db, entityId: string, _periodId: string): ReconBreak[] {
  const fixture = loadReconFixtureTolerant(entityId); // missing → empty; malformed → throws
  // TODO(multi-period): _periodId is currently ignored — all entity JEs count toward the single demo period. Apply a date/period cutoff filter here when multi-period lands (spec §8).
  const { byKey, control } = walletAssetMovements(db, entityId);

  // Row keys = union of fixture keys and book-movement keys (two-directional).
  const keys = new Set<string>(fixture.map((f) => `${f.wallet}|${f.coinType}`));
  for (const k of Object.keys(byKey)) keys.add(k);

  const fixByKey = new Map(fixture.map((f) => [`${f.wallet}|${f.coinType}`, f]));
  const out: ReconBreak[] = [];
  for (const key of keys) {
    const sep = key.indexOf('|');
    const wallet = key.slice(0, sep);
    const coinType = key.slice(sep + 1);
    const fx = fixByKey.get(key);
    const opening = fx ? BigInt(fx.openingMinor) : 0n;
    const statement = fx ? BigInt(fx.statementMinor) : 0n;
    const threshold = fx ? BigInt(fx.thresholdMinor) : 0n;
    const movement = byKey[key] ?? 0n;
    const computed = opening + movement;
    const brk = computed - statement;
    const ctl = control[key] ?? { debit: 0n, credit: 0n, legs: 0 };
    const abs = brk < 0n ? -brk : brk;
    // material = a nonzero break at or above threshold. A zero break is always balanced,
    // even when threshold === 0 (zero-tolerance still requires an actual difference).
    const material = abs > 0n && abs >= threshold;
    out.push({
      wallet, coinType, decimals: fx?.decimals ?? 9,
      openingMinor: opening.toString(), movementMinor: movement.toString(), computedMinor: computed.toString(),
      statementMinor: statement.toString(), breakMinor: brk.toString(), thresholdMinor: threshold.toString(),
      material,
      control: { debitMinor: ctl.debit.toString(), creditMinor: ctl.credit.toString(), legs: ctl.legs },
    });
  }
  out.sort((a, b) => Number(b.material) - Number(a.material) || a.coinType.localeCompare(b.coinType));
  return out;
}

// The recon half of the close gate: material breaks nobody has decided yet. /close-readiness,
// /snapshot and the cockpit recon light all call this, so they cannot diverge. "Undecided" spans
// open and deferred alike — see blocksClose, which is where that rule actually lives.
export function openMaterialReconBlockers(db: Db, entityId: string, periodId: string): ReconBreak[] {
  return collectBreaks(db, entityId, periodId)
    .filter((b) => b.material && blocksClose(getReconDisposition(db, entityId, periodId, b.wallet, b.coinType)));
}
