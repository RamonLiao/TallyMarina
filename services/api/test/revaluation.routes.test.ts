/**
 * Task 6 (revaluation orchestration): GET /entities/:id/revaluation/preview and
 * POST /entities/:id/revaluation/run.
 *
 * WHY these tests matter (Rule 9):
 * - all-or-nothing PRICE_MISSING: a run that silently skips an unpriced coin produces a
 *   period-end balance sheet that is part-revalued — a CPA-rejected artifact. One missing
 *   coin must 400 the WHOLE run with zero writes.
 * - dual fingerprints + 409 REVAL_ALREADY_CURRENT: a double-clicked run must never post a
 *   second identical layer of unrealized P&L.
 * - rerun reversal: superseding a run without reversing its JEs leaves the old delta in the
 *   ledger forever (double counting). Reversal keys must be bound to the OLD run id so a
 *   replayed rerun collides instead of stacking reversals.
 * - ASU 2023-08 transition: the one-time `reval-open:` cumulative-effect JE must fire on the
 *   FIRST GAAP_FV run only; a second emission would be dedup-swallowed by the ledger (amount
 *   lost, no exception) — exactly-once is the api layer's job, and seq-0 rows are permanent.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';
import type { Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';
import { lockPeriod } from '../src/periodLock/store.js';

const E = 'e1';
const P = '2026-Q2';
const ASOF = '2026-06-30';
const SUI = '0x2::sui::SUI';
const USDC = '0xbeef::usdc::USDC';

interface RawOver { [k: string]: unknown }
function opening(over: RawOver = {}): RawOver {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'OPENING_LOT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: SUI,
    assetDecimals: 9, quantityMinor: '1000000000', eventTime: '2026-04-01T00:00:00Z',
    economicPurpose: 'OPENING_BALANCE', ownershipChange: true, openingCostMinor: '500000',
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}

async function freshApp(): Promise<FastifyInstance & { _db: Db }> {
  const app = await buildTestApp(false);
  insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  registerTestAsset(app._db, E, SUI, 9);
  registerTestAsset(app._db, E, USDC, 6);
  return app;
}
function seedAuto(db: Db, id: string, raw: RawOver): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, {
    aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null,
    aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO',
  });
}

/** Seed: 1 SUI lot @ cost $5,000.00 and 2 USDC lot @ cost $2.00, posted via run-rules. */
async function seedLots(app: FastifyInstance & { _db: Db }): Promise<void> {
  seedAuto(app._db, 'open-sui', opening({ eventId: 'open-sui' }));
  seedAuto(app._db, 'open-usdc', opening({
    eventId: 'open-usdc', coinType: USDC, assetDecimals: 6, quantityMinor: '2000000',
    openingCostMinor: '200', txDigest: 'DIGUSDC', eventTime: '2026-04-02T00:00:00Z',
  }));
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
  expect(r.statusCode).toBe(200);
}

async function postPrice(app: FastifyInstance, coinType: string, price: string): Promise<void> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/prices`, payload: { coinType, asOf: ASOF, price } });
  expect(r.statusCode).toBe(201);
}

function counts(db: Db): Record<string, number> {
  const n = (t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return { je: n('journal_entries'), lv: n('lot_valuation'), rr: n('revaluation_run'), ev: n('events') };
}

async function preview(app: FastifyInstance): Promise<{ statusCode: number; body: PreviewBody }> {
  const r = await app.inject({ method: 'GET', url: `/entities/${E}/revaluation/preview?periodId=${P}` });
  return { statusCode: r.statusCode, body: r.json() as PreviewBody };
}
interface PreviewRow {
  coinType: string; basis: string; priorCarryingMinor: string; currentValueMinor: string;
  deltaMinor: string; missingPrice: boolean;
  lots: Array<{ lotId: string; qtyMinor: string; priorCarryingMinor: string; currentValueMinor: string; deltaMinor: string }>;
}
interface PreviewBody {
  rows: PreviewRow[];
  journalDraft: Array<{ account: string; side: string; amountMinor: string }>;
  priceMissing: string[];
}

async function runReval(app: FastifyInstance): Promise<{ statusCode: number; body: { runId: string; jeIds: string[]; reversedRunId: string | null; error?: { code: string; message: string } } }> {
  const r = await app.inject({ method: 'POST', url: `/entities/${E}/revaluation/run`, payload: { periodId: P } });
  return { statusCode: r.statusCode, body: r.json() };
}

async function patchToGaap(app: FastifyInstance, asu: Record<string, boolean>): Promise<void> {
  const r = await app.inject({
    method: 'PATCH', url: '/policy/policy-set',
    payload: { entity: E, actor: 'cpa', reason: 'adopt ASU 2023-08', changes: { accountingStandard: 'US_GAAP', asu202308Applies: asu } },
  });
  expect(r.statusCode).toBe(200);
}

function journalKeys(db: Db): string[] {
  return (db.prepare('SELECT idempotency_key AS k FROM journal_entries WHERE entity_id = ? ORDER BY idempotency_key').all(E) as Array<{ k: string }>).map((r) => r.k);
}
interface LvRow { lot_id: string; run_id: string; seq: number; basis: string; delta_minor: string; reason: string; superseded_by: string | null; je_id: string | null }
function lvRows(db: Db): LvRow[] {
  return db.prepare('SELECT lot_id, run_id, seq, basis, delta_minor, reason, superseded_by, je_id FROM lot_valuation WHERE entity_id = ? ORDER BY created_at, seq').all(E) as LvRow[];
}

describe('revaluation preview/run orchestration (Task 6)', () => {
  it('preview: 200 with per-asset/per-lot rows, draft JE, empty priceMissing — and ZERO DB writes', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');   // 1 SUI @ $3000 → value 300000 < cost 500000 → impair 200000
    await postPrice(app, USDC, '1.00');     // 2 USDC @ $1 → value 200 == cost 200 → no change

    const before = counts(app._db);
    const { statusCode, body } = await preview(app);
    expect(statusCode).toBe(200);
    expect(counts(app._db)).toEqual(before); // preview is READ-ONLY

    expect(body.priceMissing).toEqual([]);
    const sui = body.rows.find((r) => r.coinType === SUI)!;
    expect(sui.basis).toBe('IFRS_COST'); // seed policy default is IFRS
    expect(sui.missingPrice).toBe(false);
    expect(sui.deltaMinor).toBe('-200000');
    expect(sui.lots).toHaveLength(1);
    expect(sui.lots[0]).toMatchObject({ lotId: 'OPEN-open-sui', qtyMinor: '1000000000', priorCarryingMinor: '500000', currentValueMinor: '300000', deltaMinor: '-200000' });
    const usdc = body.rows.find((r) => r.coinType === USDC)!;
    expect(usdc.deltaMinor).toBe('0');
    expect(usdc.missingPrice).toBe(false);
    // Draft JE: impairment loss under IFRS cost track.
    expect(body.journalDraft).toContainEqual({ account: 'ImpairmentLoss', side: 'DEBIT', amountMinor: '200000' });
    expect(body.journalDraft).toContainEqual({ account: 'DigitalAssets', side: 'CREDIT', amountMinor: '200000' });
  });

  it('preview: missing price coin reported in priceMissing, not a 400, still zero writes', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00'); // USDC deliberately unpriced

    const before = counts(app._db);
    const { statusCode, body } = await preview(app);
    expect(statusCode).toBe(200);
    expect(counts(app._db)).toEqual(before);
    expect(body.priceMissing).toEqual([USDC]);
    const usdc = body.rows.find((r) => r.coinType === USDC)!;
    expect(usdc.missingPrice).toBe(true);
    // The priced coin still previews normally.
    expect(body.rows.find((r) => r.coinType === SUI)!.deltaMinor).toBe('-200000');
  });

  it('run: 201 with runId/jeIds; reval: JE, lot_valuation rows, dual fingerprints persisted', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');
    await postPrice(app, USDC, '1.00');

    const { statusCode, body } = await runReval(app);
    expect(statusCode).toBe(201);
    expect(body.runId).toBeTruthy();
    expect(body.jeIds.length).toBe(1);
    expect(body.reversedRunId).toBeNull();

    const keys = journalKeys(app._db);
    expect(keys).toContain(`reval:${E}:${P}:1:${SUI}`);

    const lv = lvRows(app._db);
    expect(lv).toHaveLength(1);
    expect(lv[0]).toMatchObject({ lot_id: 'OPEN-open-sui', seq: 1, basis: 'IFRS_COST', delta_minor: '-200000', reason: 'IMPAIR', superseded_by: null });
    expect(lv[0]!.je_id).toBeTruthy();

    const run = app._db.prepare('SELECT * FROM revaluation_run WHERE id = ?').get(body.runId) as Record<string, unknown>;
    expect(run.price_set_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.lot_set_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.reversal_of_run_id).toBeNull();
    // FK anchor: the system event exists and the JE points at it, with explicit periodId.
    const je = app._db.prepare('SELECT event_id, period_id FROM journal_entries WHERE id = ?').get(body.jeIds[0]) as { event_id: string; period_id: string };
    expect(je.event_id).toBe(`evt-reval-${body.runId}`);
    expect(je.period_id).toBe(P);
  });

  it('run: ONE unpriced coin 400s the WHOLE run (all-or-nothing) with zero writes', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00'); // USDC unpriced

    const before = counts(app._db);
    const { statusCode, body } = await runReval(app);
    expect(statusCode).toBe(400);
    expect((body as { error?: { code: string; message: string } }).error?.code).toBe('PRICE_MISSING');
    expect((body as { error?: { code: string; message: string } }).error?.message).toContain(USDC);
    expect(counts(app._db)).toEqual(before);
  });

  it('run: registry missing decimals counts as PRICE_MISSING (fail-closed)', async () => {
    const app = await buildTestApp(false);
    insertEntity(app._db, { id: E, displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
    registerTestAsset(app._db, E, SUI, 9); // USDC NOT registered
    seedAuto(app._db, 'open-sui', opening({ eventId: 'open-sui' }));
    seedAuto(app._db, 'open-usdc', opening({
      eventId: 'open-usdc', coinType: USDC, assetDecimals: 6, quantityMinor: '2000000',
      openingCostMinor: '200', txDigest: 'DIGUSDC', eventTime: '2026-04-02T00:00:00Z',
    }));
    await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    await postPrice(app, SUI, '3000.00');
    // No price row is even possible for unregistered USDC (price route rejects) — the run
    // must 400 on the registry gap rather than skip the coin.
    const { statusCode, body } = await runReval(app);
    expect(statusCode).toBe(400);
    expect((body as { error?: { code: string } }).error?.code).toBe('PRICE_MISSING');
  });

  it('run: LOCKED period → 409 PERIOD_LOCKED', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');
    await postPrice(app, USDC, '1.00');
    lockPeriod(app._db, { entityId: E, periodId: P, lightsSnapshot: '[]', lockedBy: 'test', now: Date.now() });

    const { statusCode, body } = await runReval(app);
    expect(statusCode).toBe(409);
    expect((body as { error?: { code: string } }).error?.code).toBe('PERIOD_LOCKED');
  });

  it('run replay (double-click): identical fingerprints + policy version → 409 REVAL_ALREADY_CURRENT', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');
    await postPrice(app, USDC, '1.00');

    expect((await runReval(app)).statusCode).toBe(201);
    const before = counts(app._db);
    const second = await runReval(app);
    expect(second.statusCode).toBe(409);
    expect((second.body as { error?: { code: string } }).error?.code).toBe('REVAL_ALREADY_CURRENT');
    expect(counts(app._db)).toEqual(before); // nothing posted twice
  });

  it('rerun after price change: reversal JE per old JE, old valuations superseded, new run links reversalOfRunId', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');
    await postPrice(app, USDC, '1.00');
    const first = await runReval(app);
    expect(first.statusCode).toBe(201);
    const run1 = first.body.runId;

    await postPrice(app, SUI, '4000.00'); // supersedes the 3000 price → fingerprints differ
    const second = await runReval(app);
    expect(second.statusCode).toBe(201);
    const run2 = second.body.runId;
    expect(second.body.reversedRunId).toBe(run1);

    const keys = journalKeys(app._db);
    // Old impairment JE reversed with a key bound to the OLD run id.
    expect(keys).toContain(`reval-rev:${run1}:${SUI}`);
    const rev = app._db.prepare('SELECT je_json FROM journal_entries WHERE idempotency_key = ?')
      .get(`reval-rev:${run1}:${SUI}`) as { je_json: string };
    const revJe = JSON.parse(rev.je_json) as { reversalOf: string; lines: Array<{ account: string; side: string; amountMinor: string }> };
    expect(revJe.reversalOf).toBe(`reval:${E}:${P}:1:${SUI}`);
    // Dr/Cr swapped vs the original (ImpairmentLoss was DEBIT).
    expect(revJe.lines).toContainEqual(expect.objectContaining({ account: 'ImpairmentLoss', side: 'CREDIT', amountMinor: '200000' }));

    // New run posts fresh impairment from clean baseline: 500000 - 400000 = 100000.
    expect(keys).toContain(`reval:${E}:${P}:2:${SUI}`);
    const lv = lvRows(app._db);
    const oldRow = lv.find((r) => r.run_id === run1)!;
    expect(oldRow.superseded_by).toBe(run2);
    const newRow = lv.find((r) => r.run_id === run2)!;
    expect(newRow).toMatchObject({ seq: 2, delta_minor: '-100000', superseded_by: null });

    const runRow = app._db.prepare('SELECT reversal_of_run_id FROM revaluation_run WHERE id = ?').get(run2) as { reversal_of_run_id: string };
    expect(runRow.reversal_of_run_id).toBe(run1);
  });

  it('IFRS → US_GAAP transition: first GAAP_FV run posts reval-open, reverses IFRS layer; second GAAP run does NOT re-post reval-open and leaves seq-0 unsuperseded', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');
    await postPrice(app, USDC, '1.00');
    // First run under seed IFRS policy → impairment layer.
    const ifrsRun = await runReval(app);
    expect(ifrsRun.statusCode).toBe(201);

    // Adopt US GAAP: SUI in ASU 2023-08 scope (GAAP_FV), USDC out of scope (GAAP_COST).
    await patchToGaap(app, { [SUI]: true, [USDC]: false });

    // Same prices, new policy version → fingerprint/version gate lets the rerun through.
    const gaap1 = await runReval(app);
    expect(gaap1.statusCode).toBe(201);
    expect(gaap1.body.reversedRunId).toBe(ifrsRun.body.runId);

    let keys = journalKeys(app._db);
    // One-time cumulative-effect JE: opening FV 300000 vs cost 500000 → RetainedEarnings.
    expect(keys).toContain(`reval-open:${E}:${SUI}`);
    // IFRS layer reversed.
    expect(keys).toContain(`reval-rev:${ifrsRun.body.runId}:${SUI}`);
    const lv1 = lvRows(app._db);
    const seq0 = lv1.filter((r) => r.seq === 0);
    expect(seq0).toHaveLength(1);
    expect(seq0[0]).toMatchObject({ lot_id: 'OPEN-open-sui', basis: 'GAAP_FV', reason: 'OPENING_FV', delta_minor: '-200000', superseded_by: null });

    // Second GAAP run: price moves 3000 → 4000.
    await postPrice(app, SUI, '4000.00');
    const gaap2 = await runReval(app);
    expect(gaap2.statusCode).toBe(201);

    keys = journalKeys(app._db);
    // Still exactly ONE reval-open key — the transition never fires twice.
    expect(keys.filter((k) => k.startsWith('reval-open:'))).toHaveLength(1);
    // GAAP_FV revaluation from the opening baseline: 400000 - 300000 = +100000.
    const gaapJe = app._db.prepare('SELECT je_json FROM journal_entries WHERE idempotency_key = ?')
      .get(`reval:${E}:${P}:3:${SUI}`) as { je_json: string };
    const je = JSON.parse(gaapJe.je_json) as { lines: Array<{ account: string; side: string; amountMinor: string }> };
    expect(je.lines).toContainEqual(expect.objectContaining({ account: 'UnrealizedGainCryptoPnL', side: 'CREDIT', amountMinor: '100000' }));

    const lv2 = lvRows(app._db);
    // seq-0 opening row survives BOTH supersede passes (D6: never superseded).
    const seq0After = lv2.filter((r) => r.seq === 0);
    expect(seq0After).toHaveLength(1);
    expect(seq0After[0]!.superseded_by).toBeNull();
    // gaap1's seq>0 rows (if any) superseded by gaap2. (At 3000, current == opening FV → the
    // transition run has NO seq>0 GAAP_FV row; the IFRS run's row was superseded by gaap1.)
    const gaap2Row = lv2.find((r) => r.run_id === gaap2.body.runId && r.seq > 0)!;
    expect(gaap2Row).toMatchObject({ basis: 'GAAP_FV', reason: 'REVALUE', delta_minor: '100000', superseded_by: null });
  });

  it('preview after policy switch is rerun-shaped and still zero-write (mixed-basis history must not corrupt the fold)', async () => {
    const app = await freshApp();
    await seedLots(app);
    await postPrice(app, SUI, '3000.00');
    await postPrice(app, USDC, '1.00');
    expect((await runReval(app)).statusCode).toBe(201); // IFRS layer persisted
    await patchToGaap(app, { [SUI]: true, [USDC]: false });

    const before = counts(app._db);
    const { statusCode, body } = await preview(app);
    expect(statusCode).toBe(200);
    expect(counts(app._db)).toEqual(before); // sandboxed rerun preview rolled back
    const sui = body.rows.find((r) => r.coinType === SUI)!;
    expect(sui.basis).toBe('GAAP_FV');
    // Transition preview: opening FV draft cost 500000 → 300000.
    expect(sui.lots).toContainEqual(expect.objectContaining({ lotId: 'OPEN-open-sui', deltaMinor: '-200000' }));
    // Draft journal includes the reversal of the IFRS layer and the RetainedEarnings transition.
    expect(body.journalDraft).toContainEqual({ account: 'ImpairmentLoss', side: 'CREDIT', amountMinor: '200000' });
    expect(body.journalDraft).toContainEqual({ account: 'RetainedEarnings', side: 'DEBIT', amountMinor: '200000' });
  });

  it('validation: missing periodId → 400 on both routes; unknown period → 400', async () => {
    const app = await freshApp();
    const r1 = await app.inject({ method: 'GET', url: `/entities/${E}/revaluation/preview` });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({ method: 'POST', url: `/entities/${E}/revaluation/run`, payload: {} });
    expect(r2.statusCode).toBe(400);
    const r3 = await app.inject({ method: 'GET', url: `/entities/${E}/revaluation/preview?periodId=2099-Q9` });
    expect(r3.statusCode).toBe(400);
  });
});
