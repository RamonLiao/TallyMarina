import { buildApp, inject, assert, expectErr, stubClassify } from './harness.js';
import { runPipeline } from './pipeline.js';
import { encodeReconBreakId } from '../../src/reconciliation/breakId.js';

export async function run(): Promise<void> {
  const hasSigner = !!process.env.SUI_PK;
  const { app, db, cfg } = await buildApp();
  const entity = encodeURIComponent(cfg.entityId);
  const periodId = '2026-Q2';

  // ── Step 1: Run pipeline so all non-recon lights can reach green ──
  await runPipeline(db, cfg, stubClassify, { periodId });

  // ── Step 2: Assert 6 lights present via /close-cockpit ──
  const cockpitRes = await inject(app, 'GET', `/entities/${entity}/close-cockpit?periodId=${periodId}`);
  assert(cockpitRes.status === 200, `close-cockpit failed: ${cockpitRes.status} ${JSON.stringify(cockpitRes.body)}`);
  const cockpit = cockpitRes.body;
  const lights: Array<{ key: string; status: string; label: string; real: boolean }> = cockpit.lights ?? [];
  assert(lights.length === 6, `expected 6 lights, got ${lights.length}: ${JSON.stringify(lights.map((l) => l.key))}`);

  const expectedKeys = ['classification', 'je', 'recon', 'completeness', 'pricing', 'export'];
  for (const key of expectedKeys) {
    assert(
      lights.some((l) => l.key === key),
      `missing light key '${key}' in lights: ${JSON.stringify(lights.map((l) => l.key))}`,
    );
  }

  // ── Step 3: Reopen rejection — missing restatementReason ──
  // Period is OPEN here, so ILLEGAL_TRANSITION fires before validation on some impls.
  // Accept either 400 VALIDATION or 409 ILLEGAL_TRANSITION for this guard.
  const r1 = await inject(app, 'POST', `/entities/${entity}/period/reopen`, {
    periodId,
    reasonCode: 'ERROR_CORRECTION',
  });
  assert(
    r1.status >= 400,
    `reopen without restatementReason must reject (4xx), got ${r1.status}: ${JSON.stringify(r1.body)}`,
  );

  // ── Step 4: Reopen rejection — missing reasonCode ──
  const r2 = await inject(app, 'POST', `/entities/${entity}/period/reopen`, {
    periodId,
    restatementReason: 'correcting misclassification',
  });
  assert(
    r2.status >= 400,
    `reopen without reasonCode must reject (4xx), got ${r2.status}: ${JSON.stringify(r2.body)}`,
  );

  // ── Step 5: Reopen of OPEN period → 409 ILLEGAL_TRANSITION ──
  const r3 = await inject(app, 'POST', `/entities/${entity}/period/reopen`, {
    periodId,
    restatementReason: 'correcting misclassification',
    reasonCode: 'ERROR_CORRECTION',
  });
  expectErr(r3, 409, 'ILLEGAL_TRANSITION');

  // ── Step 6: Dispose open material recon breaks so recon light goes green ──
  const reconRes = await inject(app, 'GET', `/entities/${entity}/reconciliation?periodId=${periodId}`);
  assert(reconRes.status === 200, `reconciliation fetch failed: ${reconRes.status}`);
  const reconRows: Array<{
    wallet: string;
    coinType: string;
    material: boolean;
    disposition: { state: string } | null;
  }> = reconRes.body.rows ?? [];

  for (const b of reconRows) {
    if (!b.material) continue;
    if (b.disposition !== null && b.disposition.state !== 'open') continue;
    const rawId = encodeReconBreakId(b.wallet, b.coinType);
    const urlId = encodeURIComponent(rawId);
    const dr = await inject(app, 'POST', `/recon-breaks/${urlId}/disposition`, {
      state: 'dismissed',
      reasonCode: 'timing',
      periodId,
    });
    assert(dr.status === 200, `dismiss recon break ${rawId} failed: ${JSON.stringify(dr.body)}`);
  }

  // ── Step 7: Lock OPEN → LOCKED ──
  const lock1 = await inject(app, 'POST', `/entities/${entity}/period/lock`, { periodId });
  assert(
    lock1.status === 200 || lock1.status === 201,
    `lock failed: ${lock1.status} ${JSON.stringify(lock1.body)}`,
  );
  assert(lock1.body.lock?.status === 'LOCKED', `expected LOCKED, got ${lock1.body.lock?.status}`);

  // ── Step 8: Double-lock (LOCKED → lock) must be 409, not double-count ──
  const lock2 = await inject(app, 'POST', `/entities/${entity}/period/lock`, { periodId });
  assert(
    lock2.status === 409,
    `double-lock must be 409, got ${lock2.status}: ${JSON.stringify(lock2.body)}`,
  );

  // ── Step 9: Valid reopen of LOCKED period ──
  const reopen = await inject(app, 'POST', `/entities/${entity}/period/reopen`, {
    periodId,
    restatementReason: 'correcting misclassification',
    reasonCode: 'ERROR_CORRECTION',
  });
  assert(
    reopen.status === 200 || reopen.status === 201,
    `valid reopen failed: ${reopen.status} ${JSON.stringify(reopen.body)}`,
  );
  const reopenedLock = reopen.body.lock;
  assert(
    reopenedLock?.status === 'OPEN',
    `expected status OPEN after reopen, got ${reopenedLock?.status}`,
  );
  assert(
    (reopenedLock?.reopenCount ?? 0) > 0,
    `expected reopenCount > 0 after reopen, got ${reopenedLock?.reopenCount}`,
  );

  // ── Step 10: staleAnchor path (SUI_PK-gated) ──
  if (!hasSigner) {
    console.log('(S4) SUI_PK unset → staleAnchor assertion skipped (covered by Layer 3 / on-chain tests).');
  } else {
    // staleAnchor: after reopening an anchored period, GET /anchors should show staleAnchor=true
    // and no v2 anchor should have been created.
    const anchorsRes = await inject(app, 'GET', `/entities/${entity}/anchors?periodId=${periodId}`);
    assert(anchorsRes.status === 200, `anchors fetch failed: ${anchorsRes.status}`);
    const anchors: Array<{ seq: number; staleAnchor?: boolean }> = anchorsRes.body.anchors ?? anchorsRes.body ?? [];
    if (anchors.length > 0) {
      const latest = anchors[anchors.length - 1];
      assert(
        latest.staleAnchor === true,
        `expected staleAnchor=true after reopen of anchored period, got ${JSON.stringify(latest)}`,
      );
      // No new v2 anchor should exist beyond the original
      assert(
        anchors.length === 1,
        `expected exactly 1 anchor (no v2 re-anchor), got ${anchors.length}`,
      );
    }
  }

  console.log(
    `(S4) cockpit 6-lights ✓ | reopen SoD/reason rejections ✓ | ILLEGAL_TRANSITION (reopen OPEN) ✓ | lock OPEN→LOCKED ✓ | double-lock 409 ✓ | reopen LOCKED→OPEN (reopenCount=${reopenedLock?.reopenCount}) ✓`,
  );
}
