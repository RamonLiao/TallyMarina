import { buildApp, inject, assert, expectErr, lowConfidenceOnce } from './harness.js';
import { runPipeline } from './pipeline.js';
import { listEvents, listByStatus } from '../../src/store/eventStore.js';

export async function run(): Promise<void> {
  // Build app with lowConfidenceOnce: first classify call → confidence 0.10 → NEEDS_REVIEW
  const client = lowConfidenceOnce();
  const { app, db, cfg } = await buildApp({ classifyClient: client });
  const entity = encodeURIComponent(cfg.entityId);
  const periodId = '2026-Q2';

  // ── Step 1: Classify all events via HTTP ──
  // First event gets low confidence → NEEDS_REVIEW → CLASSIFY_REVIEW exception (blocking)
  const evRes = await inject(app, 'GET', `/entities/${entity}/events`);
  assert(evRes.status === 200, `events fetch failed: ${evRes.status}`);
  const allEvents: Array<{ id: string }> = evRes.body.events ?? evRes.body;
  assert(allEvents.length > 0, 'fixture has no events');

  for (const ev of allEvents) {
    const r = await inject(app, 'POST', `/events/${ev.id}/classify`, {});
    assert(r.status === 200, `classify ${ev.id} failed: ${JSON.stringify(r.body)}`);
  }

  // ── Step 2: Verify ≥1 open blocking exception ──
  const exc1 = await inject(app, 'GET', `/entities/${entity}/exceptions`);
  assert(exc1.status === 200, `exceptions fetch failed: ${exc1.status}`);
  const { exceptions: list1, summary: sum1 } = exc1.body;
  assert(sum1.blocking >= 1, `expected ≥1 blocking exception, got ${sum1.blocking}. exceptions=${JSON.stringify(list1)}`);

  // Find the blocking exception to dispose
  const blockingEx = list1.find(
    (e: { category: string; disposition: { state: string } | null }) =>
      (e.category === 'CLASSIFY_REVIEW' || e.category === 'RULES_FAILED') &&
      (e.disposition === null || e.disposition.state === 'open'),
  );
  assert(blockingEx, `no open blocking exception found in ${JSON.stringify(list1)}`);
  const exId = blockingEx.exceptionId as string;

  // ── Step 3: Lock attempt must be blocked ──
  const blocked = await inject(app, 'POST', `/entities/${entity}/period/lock`, { periodId });
  // Lock uses cockpit; when classification light is red it throws LIGHTS_NOT_GREEN
  expectErr(blocked, 409, 'LIGHTS_NOT_GREEN');

  // ── Step 4: Dispose the blocking exception (dismiss) ──
  const dispRes = await inject(
    app,
    'POST',
    `/exceptions/${encodeURIComponent(exId)}/disposition`,
    { state: 'dismissed', reasonCode: 'RECLASSIFIED', periodId },
  );
  assert(dispRes.status === 200, `disposition failed: ${JSON.stringify(dispRes.body)}`);

  // ── Step 5: Re-read — dismissed exception still appears (control-hole guard) ──
  const exc2 = await inject(app, 'GET', `/entities/${entity}/exceptions`);
  assert(exc2.status === 200, `exceptions re-fetch failed: ${exc2.status}`);
  const { exceptions: list2, summary: sum2 } = exc2.body;

  const stillThere = list2.find(
    (e: { exceptionId: string }) => e.exceptionId === exId,
  );
  assert(stillThere, `dispositioned exception ${exId} vanished from list (control hole) — list=${JSON.stringify(list2)}`);
  const dispState: string = (stillThere.disposition?.state ?? 'open') as string;
  assert(dispState !== 'open', `exception still has open disposition after dismiss: ${dispState}`);

  // ── Step 6: Assert blocking count is now 0 ──
  assert(
    sum2.blocking === 0,
    `expected 0 blocking exceptions after disposition, got ${sum2.blocking}`,
  );

  // ── Step 7: Decide the NEEDS_REVIEW event so classification.pending drops to 0 ──
  // (cockpit classificationLight requires pending===0 AND blocking===0 for green)
  const needsReview = listByStatus(db, cfg.entityId, 'NEEDS_REVIEW');
  for (const ev of needsReview) {
    const ne = JSON.parse(ev.rawJson) as { eventType?: string; economicPurpose?: string };
    const decRes = await inject(app, 'POST', `/reviews/${ev.id}/decide`, {
      finalEventType: ne.eventType ?? 'DIGITAL_ASSET_RECEIPT',
      finalPurpose: ne.economicPurpose ?? 'TRADING',
    });
    assert(decRes.status === 200, `decide ${ev.id} failed: ${JSON.stringify(decRes.body)}`);
  }

  // ── Step 8: Run rules for all APPROVED/AUTO events to post journal entries ──
  const rulesRes = await inject(app, 'POST', `/entities/${entity}/run-rules`, { periodId });
  assert(rulesRes.status === 200, `run-rules failed: ${JSON.stringify(rulesRes.body)}`);
  const jeCount: number = (rulesRes.body.journal ?? []).length;
  assert(jeCount > 0, `no journal entries after run-rules`);

  // ── Step 9: Dismiss open material recon breaks ──
  const reconRes = await inject(app, 'GET', `/entities/${entity}/reconciliation?periodId=${periodId}`);
  assert(reconRes.status === 200, `reconciliation fetch failed: ${reconRes.status}`);
  const reconRows: Array<{ wallet: string; coinType: string; material: boolean; disposition: unknown }> =
    reconRes.body.rows ?? [];
  for (const b of reconRows) {
    if (!b.material || b.disposition !== null) continue;
    const breakId = encodeURIComponent(`${b.wallet}|${b.coinType}`);
    const dr = await inject(app, 'POST', `/recon-breaks/${breakId}/disposition`, {
      state: 'dismissed',
      reasonCode: 'timing',
      periodId,
    });
    assert(dr.status === 200, `dismiss recon break ${b.wallet}|${b.coinType} failed: ${JSON.stringify(dr.body)}`);
  }

  // ── Step 10: Lock proceeds ──
  const ok = await inject(app, 'POST', `/entities/${entity}/period/lock`, { periodId });
  assert(
    ok.status === 200 || ok.status === 201,
    `lock should proceed after disposition, got ${ok.status} ${JSON.stringify(ok.body)}`,
  );
  assert(
    ok.body.lock?.status === 'LOCKED',
    `expected LOCKED status, got ${ok.body.lock?.status}`,
  );

  console.log('(S2) lock blocked while exception open → dismissed → lock proceeded. dismissed-reappears assertion PASSED.');
}
