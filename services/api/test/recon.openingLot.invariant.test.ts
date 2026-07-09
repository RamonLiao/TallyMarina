// services/api/test/recon.openingLot.invariant.test.ts
//
// Guards the invariant that reconciliation's OPENING_LOT exclusion depends on.
//
// movement.ts:38-41 skips OPENING_LOT JEs from book movement, justifying it with:
//   "its chain-side counterpart is the recon fixture's openingMinor, not a book movement"
// recon.collect.test.ts:84 demonstrates the intended relation as EQUALITY: an entity whose
// opening lot declares 3.0 TOK and whose fixture openingMinor is 3.0 TOK produces no break.
//
// Nothing enforced that. The invariant lived only in prose, so the two sides of it could —
// and did — drift apart with every test staying green: reconciliation never reads the
// ledger's opening position, and the ledger never reads the fixture's. When they disagree,
// the anchored journal asserts one opening holding while the recon screen reconciles
// against a different one, and no cross-check anywhere notices.
//
// This test is that cross-check. It compares the two fixtures directly — no DB, no server —
// because the invariant is a property of the seed data itself.
//
// Discriminator note: this reads the RAW event type from the events fixture. A human review
// can reclassify an event at runtime (final wins, see movement.ts:49), but a fixture is the
// pre-review seed, so raw is the correct — and only available — type here.
//
// STATUS: the invariant is currently VIOLATED by the demo seed, so it is quarantined behind
// `it.fails`. Three keys disagree — SUI (openingMinor 1.2 vs lot 1000), USDC (5.0 vs 0), WETH
// (2.0 vs 0) — because the recon seed (2ee4c1d, 2026-06-23) and the opening-lot seed (a67c0b5,
// 2026-07-05) were authored twelve days apart and never reconciled. Deciding which side is the
// true opening holding is an accounting call with downstream reach (JE -> leaf hash -> merkle
// root -> snapshot), so it is not made here.
//
// `it.fails` rather than `it.skip`: a skip is silent forever, whereas this turns RED the moment
// the seed is fixed, forcing whoever fixes it to delete the quarantine. To keep that quarantine
// from swallowing unrelated breakage (a renamed fixture would "fail" too, and thus pass), the
// structural preconditions live in their own ordinary test above it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadReconFixture } from '../src/reconciliation/fixture.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fixtures');
const ENTITY = 'acme:pilot-001';

interface NormalizedEvent {
  eventType: string;
  wallet: string;
  coinType: string;
  quantityMinor: string;
}

/** Σ OPENING_LOT quantityMinor per `${wallet}|${coinType}`, from the events seed. */
function openingLotQtyByKey(entityId: string): Record<string, bigint> {
  const file = join(FIXTURES, `${entityId.replace(':', '-')}.events.json`);
  const { events } = JSON.parse(readFileSync(file, 'utf8')) as {
    events: { normalized: NormalizedEvent }[];
  };
  const byKey: Record<string, bigint> = {};
  for (const { normalized: n } of events) {
    if (n.eventType !== 'OPENING_LOT') continue;
    const key = `${n.wallet}|${n.coinType}`;
    byKey[key] = (byKey[key] ?? 0n) + BigInt(n.quantityMinor);
  }
  return byKey;
}

/** Union of both sides: an opening balance with no lot is just as broken as a lot with no
 * opening balance — the first is a holding the ledger never recorded, the second is a holding
 * reconciliation never checks. */
function unionKeys(reconRows: { wallet: string; coinType: string }[], lots: Record<string, bigint>): string[] {
  return [...new Set([...reconRows.map((r) => `${r.wallet}|${r.coinType}`), ...Object.keys(lots)])].sort();
}

describe('recon fixture openingMinor ties to the ledger OPENING_LOT seed', () => {
  // Ordinary test: everything the quarantined assertion below depends on, EXCEPT the numbers.
  // Without this, a renamed or unparseable fixture would make `it.fails` pass and the drift
  // guard would evaporate silently.
  it(`${ENTITY}: both fixtures load and cover the same four wallet|coinType keys`, () => {
    const reconRows = loadReconFixture(ENTITY);
    const lots = openingLotQtyByKey(ENTITY);

    expect(reconRows.length).toBeGreaterThan(0);
    expect(Object.keys(lots).length).toBeGreaterThan(0);
    expect(unionKeys(reconRows, lots)).toEqual([
      '0xacmeTreasury|0x2::sui::SUI',
      '0xacmeTreasury|0xusdc::usdc::USDC',
      '0xacmeTreasury|0xusdt::usdt::USDT',
      '0xacmeTreasury|0xweth::weth::WETH',
    ]);
  });

  // QUARANTINED — see STATUS in the file header. Turns red once the seed is reconciled; when it
  // does, delete `.fails`, do not re-quarantine.
  it.fails(`${ENTITY}: every wallet|coinType opening balance is backed by an equal OPENING_LOT`, () => {
    const reconRows = loadReconFixture(ENTITY);
    const lots = openingLotQtyByKey(ENTITY);
    const keys = unionKeys(reconRows, lots);

    const actual = keys.map((k) => {
      const row = reconRows.find((r) => `${r.wallet}|${r.coinType}` === k);
      return `${k} openingMinor=${row?.openingMinor ?? '<no recon row>'} openingLotQty=${(lots[k] ?? 0n).toString()}`;
    });
    const expected = keys.map((k) => {
      const row = reconRows.find((r) => `${r.wallet}|${r.coinType}` === k);
      const opening = row?.openingMinor ?? '<no recon row>';
      return `${k} openingMinor=${opening} openingLotQty=${opening}`;
    });

    // Compared as strings so a failure names every offending key and both quantities at once,
    // instead of dying on the first mismatch.
    expect(actual).toEqual(expected);
  });
});
