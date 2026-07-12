/**
 * Ledger follow-up (子專案 4 前必收): re-verify the realized/unrealized split bound after the
 * C1 fix changed release/supersede semantics.
 *
 * WHY this matters (Rule 9): the trial balance (subproject 4) consumes the realized/unrealized
 * presentation split. rawDeltaComponents' proration ratio `rawPnl / (rawPnl + rawOpening)`
 * assumed every DISPOSAL_RELEASE shrinks BOTH buckets by the same qty ratio — true only while
 * the REVALUE rows the release was attributed against are still live. A rerun AFTER a partial
 * disposal supersedes those old REVALUE rows (C1 fix #2 keeps the release row alive), so the
 * live components become {opening O, NEW reval R3} while the release still embeds the OLD mix
 * {O, R1}. The ratio then misattributes the release across buckets — a PROPORTIONAL error, not
 * the pre-C1 "≤ #disposals × 1 minor" truncation residual.
 *
 * Concrete numbers (same prelude as revaluation.rerunAfterDisposal series A):
 *   opening O=+20000 (seq-0, equity) · reval R1=+20000 (P&L) · dispose 50% → release −20000
 *   (embeds −10000 O-share, −10000 R1-share) · rerun @16 → R1 superseded, reversal JE −20000,
 *   fresh R3=+30000. Live rows: O+20000, release−20000, R3+30000 → cumDelta 30000.
 *   TRUE buckets: opening (1−½)·O = 10000, P&L = 30000−10000 = 20000
 *     (cross-check: UnrealizedGainCryptoPnL GL balance is exactly −20000 here — the reversal
 *     wiped R1 and R3 re-established; FV 80000 − cost 50000 − remaining opening 10000 = 20000).
 *   Ratio-based split: 30000·30000/50000 = 18000 — off by 2000 (10% of the bucket).
 *
 * The observable: a SECOND 50% disposal must reclassify half the TRUE P&L bucket
 * (20000/2 = 10000) from UnrealizedGainCryptoPnL to DisposalGain. The broken ratio reclassifies
 * 9000, leaving the unrealized account overstated by 1000 — the exact misstatement the trial
 * balance would publish.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';
import { canonicalCoinType } from '../src/assets/normalize.js';

const E = 'e1';
const P = '2026-Q2';
const ASOF = '2026-06-30';
const SUI = '0x2::sui::SUI';
const USDC = canonicalCoinType('0xbeef::usdc::USDC');

interface RawOver { [k: string]: unknown }
function opening(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'open-sui', eventType: 'OPENING_LOT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 0, quantityMinor: '100', eventTime: '2026-04-01T00:00:00Z',
    economicPurpose: 'OPENING_BALANCE', ownershipChange: true, openingCostMinor: '100000',
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}
function swap(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'swp1', eventType: 'SPOT_TRADE_SWAP', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 0, quantityMinor: '50', eventTime: '2026-06-15T00:00:00Z',
    economicPurpose: 'SPOT_TRADE_SWAP', ownershipChange: true,
    considerationAsset: USDC, considerationQtyMinor: '75000', considerationDecimals: 0,
    rawPayloadHash: 'swphash', txDigest: 'DIGSWP', eventIndex: 0, ...over,
  };
}
function seedAuto(db: Db, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, { aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null, aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO' });
}
async function runRules(app: FastifyInstance): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
  expect(r.statusCode).toBe(200);
}
async function runReval(app: FastifyInstance): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/revaluation/run`, payload: { periodId: P } });
  expect(r.statusCode).toBe(201);
}
async function postPriceAt(app: FastifyInstance, coinType: string, asOf: string, price: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/prices`, payload: { coinType, asOf, price } });
  expect(r.statusCode).toBe(201);
}
function glBalance(db: Db, account: string, coin?: string): bigint {
  const rows = db.prepare('SELECT je_json FROM journal_entries WHERE entity_id = ?').all(E) as Array<{ je_json: string }>;
  let bal = 0n;
  for (const r of rows) {
    const je = JSON.parse(r.je_json) as { lines: Array<{ account: string; side: string; amountMinor: string; origCoinType?: string | null }> };
    for (const l of je.lines) {
      if (l.account !== account) continue;
      if (coin !== undefined && l.origCoinType !== coin) continue;
      bal += l.side === 'DEBIT' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor);
    }
  }
  return bal;
}
function jeLinesOf(db: Db, eventId: string): Array<{ account: string; side: string; amountMinor: string; leg?: string }> {
  const row = db.prepare('SELECT je_json FROM journal_entries WHERE entity_id = ? AND event_id = ?').get(E, eventId) as { je_json: string } | undefined;
  expect(row).toBeTruthy();
  return (JSON.parse(row!.je_json) as { lines: Array<{ account: string; side: string; amountMinor: string; leg?: string }> }).lines;
}

describe('realized/unrealized split survives a rerun after a partial disposal (ledger follow-up, pre-TB)', () => {
  it('second 50% disposal after [reval → 50% disposal → rerun] reclassifies HALF the true P&L bucket (10000), not the ratio-misattributed 9000', async () => {
    const app = await buildTestApp(false);
    insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
    registerTestAsset(app._db, E, SUI, 0);
    registerTestAsset(app._db, E, USDC, 0);

    // Prelude — identical to rerunAfterDisposal series A.
    seedAuto(app._db, 'open-sui', opening());
    await runRules(app);
    const pol = await app.inject({ method: 'PATCH', url: '/policy/policy-set', payload: { entity: E, actor: 'cpa', reason: 'adopt ASU 2023-08', changes: { accountingStandard: 'US_GAAP', asu202308Applies: { [SUI]: true } } } });
    expect(pol.statusCode).toBe(200);
    await postPriceAt(app, SUI, ASOF, '12.00');   // transition: opening +20000 (equity, seq-0)
    await runReval(app);
    await postPriceAt(app, SUI, ASOF, '14.00');   // period reval R1 +20000 (P&L)
    await runReval(app);
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(140000n);

    // Partial disposal #1: 50 of 100 SUI → release −20000, reclass 10000.
    await postPriceAt(app, USDC, '2026-06-15', '0.01');
    seedAuto(app._db, 'swp1', swap());
    await runRules(app);
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(70000n);

    // Rerun @ corrected price 16.00 → R1 superseded + reversed, fresh R3 +30000. DA = 80000.
    await postPriceAt(app, USDC, ASOF, '0.01');
    await postPriceAt(app, SUI, ASOF, '16.00');
    await runReval(app);
    expect(glBalance(app._db, 'DigitalAssets', SUI)).toBe(80000n);
    // Unrealized P&L bucket ground truth straight from the GL: −20000 (credit balance 20000).
    expect(glBalance(app._db, 'UnrealizedGainCryptoPnL')).toBe(-10000n - 10000n);

    // Partial disposal #2: 25 of the remaining 50 SUI (half) at the same economics.
    await postPriceAt(app, USDC, '2026-06-16', '0.01');
    seedAuto(app._db, 'swp2', swap({ eventId: 'swp2', quantityMinor: '25', considerationQtyMinor: '40000', eventTime: '2026-06-16T00:00:00Z', txDigest: 'DIGSWP2', rawPayloadHash: 'swphash2' }));
    await runRules(app);

    // THE invariant: half of the TRUE remaining P&L bucket (20000) is reclassified — 10000.
    // The ratio split (rawPnl 30000 / rawTotal 50000 of cumDelta 30000 = 18000) yields 9000.
    const reclass = jeLinesOf(app._db, 'swp2').find((l) => l.leg === 'UNREALIZED_GAIN_RECLASS');
    expect(reclass).toBeTruthy();
    expect(reclass!.amountMinor).toBe('10000');

    // And the unrealized account lands at −10000 (half the bucket stays unrealized), so the
    // trial balance reads UnrealizedGain 10000 / cumulative realized reclass 20000.
    expect(glBalance(app._db, 'UnrealizedGainCryptoPnL')).toBe(-10000n);
  });
});
