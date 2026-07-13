/**
 * Task 3 — buildRollForward(). Implements the formula PINNED by
 * docs/superpowers/specs/2026-07-13-rollforward-identity-memo.md §5 (Candidate B: disposals at
 * carrying, gains/losses = unrealized remeasurement delta sign-split per valuation row, OPENING_LOT
 * counted as an addition in its own period). Scenario-building helpers below mirror
 * reports.rollforward.derivation.test.ts (Task 2's executable derivation) — duplicated here rather
 * than imported, since that file is test-local and this task's boundary is scoped to this file.
 *
 * Rule 9 note: the two-period scenario (test 2/3) is the SAME real revaluation walk Task 2 used
 * to pin the formula (acquire → transition → reval → partial disposal → rerun/supersede →
 * cross-period reval → second disposal → new-lot acquisition), so identity① and ② are checked
 * against independently-known closing values (80000 / 110000), not just self-consistency — a
 * broken fold would move those anchors, not just flip a boolean.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';
import { canonicalCoinType } from '../src/assets/normalize.js';
import { buildRollForward } from '../src/reports/rollForward.js';

const SUI = '0x2::sui::SUI';
const USDC = canonicalCoinType('0xbeef::usdc::USDC');
const Q2 = '2026-Q2';
const Q3 = '2026-Q3';

interface RawOver { [k: string]: unknown }
function opening(entityId: string, over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'open-sui', eventType: 'OPENING_LOT', eventGroupId: null,
    entityId, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 0, quantityMinor: '100', eventTime: '2026-04-01T00:00:00Z',
    economicPurpose: 'OPENING_BALANCE', ownershipChange: true, openingCostMinor: '100000',
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}
function swap(entityId: string, over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'swp1', eventType: 'SPOT_TRADE_SWAP', eventGroupId: null,
    entityId, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 0, quantityMinor: '50', eventTime: '2026-06-15T00:00:00Z',
    economicPurpose: 'SPOT_TRADE_SWAP', ownershipChange: true,
    considerationAsset: USDC, considerationQtyMinor: '75000', considerationDecimals: 0,
    rawPayloadHash: 'swphash', txDigest: 'DIGSWP', eventIndex: 0, ...over,
  };
}
function seedAuto(db: Db, entityId: string, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, { aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null, aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO' });
}
async function runRules(app: FastifyInstance, entityId: string, periodId: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${entityId}/run-rules`, payload: { periodId } });
  expect(r.statusCode).toBe(200);
}
async function runReval(app: FastifyInstance, entityId: string, periodId: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${entityId}/revaluation/run`, payload: { periodId } });
  expect(r.statusCode).toBe(201);
}
async function postPriceAt(app: FastifyInstance, entityId: string, coinType: string, asOf: string, price: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${entityId}/prices`, payload: { coinType, asOf, price } });
  expect(r.statusCode).toBe(201);
}
async function adoptAsu(app: FastifyInstance, entityId: string, asu202308Applies: Record<string, boolean>): Promise<void> {
  const r = await app.inject({
    method: 'PATCH', url: '/policy/policy-set',
    payload: { entity: entityId, actor: 'cpa', reason: 'adopt ASU 2023-08', changes: { accountingStandard: 'US_GAAP', asu202308Applies } },
  });
  expect(r.statusCode).toBe(200);
}

// Full two-period scenario (identical walk to Task 2's derivation test): known closing 80000 (Q2)
// / 110000 (Q3) for SUI, plus incidental USDC lots from the swaps' consideration leg (exercises
// the coin-scoped tie-out / exclusion paths — see rollForward.ts's digitalAssetsClosingForCoins).
async function seedTwoPeriodScenario(app: FastifyInstance & { _db: Db }, entityId: string): Promise<void> {
  insertEntity(app._db, { id: entityId, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  registerTestAsset(app._db, entityId, SUI, 0);
  registerTestAsset(app._db, entityId, USDC, 0);

  seedAuto(app._db, entityId, 'open-sui', opening(entityId));
  await runRules(app, entityId, Q2);
  await adoptAsu(app, entityId, { [SUI]: true, [USDC]: false });
  await postPriceAt(app, entityId, SUI, '2026-06-30', '12.00');   // transition OPENING_FV +20000
  await runReval(app, entityId, Q2);
  await postPriceAt(app, entityId, SUI, '2026-06-30', '14.00');   // period reval R1 +20000
  await runReval(app, entityId, Q2);
  await postPriceAt(app, entityId, USDC, '2026-06-15', '0.01');
  seedAuto(app._db, entityId, 'swp1', swap(entityId));
  await runRules(app, entityId, Q2);
  await postPriceAt(app, entityId, USDC, '2026-06-30', '0.01');
  await postPriceAt(app, entityId, SUI, '2026-06-30', '16.00');   // rerun: R1 superseded, fresh R3 +30000
  await runReval(app, entityId, Q2);

  seedAuto(app._db, entityId, 'open-sui-2', opening(entityId, { eventId: 'open-sui-2', quantityMinor: '30', openingCostMinor: '30000', eventTime: '2026-08-01T00:00:00Z', txDigest: 'DIG2', rawPayloadHash: 'beef2', eventIndex: 1 }));
  await runRules(app, entityId, Q3);
  await postPriceAt(app, entityId, SUI, '2026-09-30', '20.00');   // cross-period reval: A +20000, B +30000
  await postPriceAt(app, entityId, USDC, '2026-09-30', '0.01');
  await runReval(app, entityId, Q3);
  await postPriceAt(app, entityId, USDC, '2026-08-15', '0.01');
  seedAuto(app._db, entityId, 'swp2', swap(entityId, { eventId: 'swp2', quantityMinor: '25', considerationQtyMinor: '40000', eventTime: '2026-08-15T00:00:00Z', txDigest: 'DIGSWP2', rawPayloadHash: 'swphash2' }));
  await runRules(app, entityId, Q3);
}

describe('buildRollForward', () => {
  it('IFRS 軌 → notApplicable=true, reason="IFRS", identitiesOk=true（裁決 6）', async () => {
    const app = await buildTestApp(false);
    const E = 'e-ifrs';
    insertEntity(app._db, { id: E, displayName: 'IfrsCo', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
    // default seeded policy is IFRS (policyStore.SEED_POLICY_DOC) — no PATCH needed.
    const rf = buildRollForward(app._db, E, Q2);
    expect(rf).toEqual({ notApplicable: true, reason: 'IFRS', rows: [], tbTie: null, identitiesOk: true });
  });

  it('GAAP FV 軌、完整 scenario（同 Task 2 seed）→ 逐資產恆等式① identityOk=true', async () => {
    const app = await buildTestApp(false);
    const E = 'e-full';
    await seedTwoPeriodScenario(app, E);

    const q2 = buildRollForward(app._db, E, Q2);
    const q3 = buildRollForward(app._db, E, Q3);

    expect(q2.notApplicable).toBe(false);
    const q2Sui = q2.rows.find((r) => r.coinType === SUI);
    const q3Sui = q3.rows.find((r) => r.coinType === SUI);
    expect(q2Sui?.identityOk).toBe(true);
    expect(q3Sui?.identityOk).toBe(true);
    expect(q2Sui).toMatchObject({
      openingFvMinor: '0', additionsMinor: '100000', disposalsMinor: '70000',
      gainsMinor: '50000', lossesMinor: '0', closingFvMinor: '80000',
    });
    expect(q3Sui).toMatchObject({
      openingFvMinor: '80000', additionsMinor: '30000', disposalsMinor: '50000',
      gainsMinor: '50000', lossesMinor: '0', closingFvMinor: '110000',
    });
    expect(q2.identitiesOk).toBe(true);
    expect(q3.identitiesOk).toBe(true);
  });

  it('恆等式②：closingFvTotal == 同期 TB 的 DigitalAssets closingMinor（coin-scoped）', async () => {
    const app = await buildTestApp(false);
    const E = 'e-tie';
    await seedTwoPeriodScenario(app, E);

    const q2 = buildRollForward(app._db, E, Q2);
    const q3 = buildRollForward(app._db, E, Q3);

    expect(q2.tbTie).toEqual({ digitalAssetsClosingMinor: '80000', closingFvTotalMinor: '80000', ok: true });
    expect(q3.tbTie).toEqual({ digitalAssetsClosingMinor: '110000', closingFvTotalMinor: '110000', ok: true });
  });

  it('gains/losses 拆列：升值期 gains>0 losses=0；貶值期反之（sign-split）', async () => {
    const app = await buildTestApp(false);
    const E = 'e-signsplit';
    insertEntity(app._db, { id: E, displayName: 'SignCo', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
    registerTestAsset(app._db, E, SUI, 0);

    seedAuto(app._db, E, 'open-sui', opening(E));
    await runRules(app, E, Q2);
    await adoptAsu(app, E, { [SUI]: true });
    await postPriceAt(app, E, SUI, '2026-06-30', '11.00');   // transition OPENING_FV: +10000 (gain)
    await runReval(app, E, Q2);
    await postPriceAt(app, E, SUI, '2026-06-30', '12.00');   // period reval up: gains>0
    await runReval(app, E, Q2);

    await postPriceAt(app, E, SUI, '2026-09-30', '9.00');    // period reval down (Q3): losses>0
    await runReval(app, E, Q3);

    const q2 = buildRollForward(app._db, E, Q2);
    const q3 = buildRollForward(app._db, E, Q3);
    const q2Sui = q2.rows.find((r) => r.coinType === SUI)!;
    const q3Sui = q3.rows.find((r) => r.coinType === SUI)!;

    expect(BigInt(q2Sui.gainsMinor) > 0n).toBe(true);
    expect(q2Sui.lossesMinor).toBe('0');
    expect(q2Sui.identityOk).toBe(true);

    expect(BigInt(q3Sui.lossesMinor) > 0n).toBe(true);
    expect(q3Sui.gainsMinor).toBe('0');
    expect(q3Sui.identityOk).toBe(true);
  });

  it('asu_2023_08_applies=false 的 coin 不出列', async () => {
    const app = await buildTestApp(false);
    const E = 'e-excl';
    await seedTwoPeriodScenario(app, E); // adopts { [SUI]: true, [USDC]: false }
    const rf = buildRollForward(app._db, E, Q2);
    expect(rf.rows.map((r) => r.coinType)).toEqual([SUI]);
    expect(rf.rows.some((r) => r.coinType === USDC)).toBe(false);
  });

  it('空期（無該類資產活動）→ rows=[]、identitiesOk=true', async () => {
    const app = await buildTestApp(false);
    const E = 'e-empty';
    insertEntity(app._db, { id: E, displayName: 'EmptyCo', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
    await adoptAsu(app, E, {}); // US_GAAP, but no coin flagged ASU-applicable
    const rf = buildRollForward(app._db, E, Q2);
    expect(rf.notApplicable).toBe(false);
    expect(rf.rows).toEqual([]);
    expect(rf.tbTie).toEqual({ digitalAssetsClosingMinor: '0', closingFvTotalMinor: '0', ok: true });
    expect(rf.identitiesOk).toBe(true);
  });
});
