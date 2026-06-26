import { buildApp, inject, assert, expectErr, stubClassify } from './harness.js';
import { runPipeline } from './pipeline.js';
import { encodeReconBreakId } from '../../src/reconciliation/breakId.js';

export async function run(): Promise<void> {
  const { app, db, cfg } = await buildApp();
  const entity = encodeURIComponent(cfg.entityId);
  const periodId = '2026-Q2';

  // ── Step 1: Run classify → rules → snapshot to satisfy non-recon lights ──
  await runPipeline(db, cfg, stubClassify, { periodId });

  // ── Step 2: Fetch reconciliation — expect ≥1 material break ──
  const recon1 = await inject(app, 'GET', `/entities/${entity}/reconciliation?periodId=${periodId}`);
  assert(recon1.status === 200, `reconciliation fetch failed: ${recon1.status} ${JSON.stringify(recon1.body)}`);

  const rows: Array<{
    wallet: string;
    coinType: string;
    material: boolean;
    disposition: { state: string; reasonCode: string; reasonNote?: string } | null;
  }> = recon1.body.rows ?? [];

  const summary1 = recon1.body.summary as { material: number; openMaterial: number; balanced: boolean };

  const materialRows = rows.filter((r) => r.material === true);
  assert(
    materialRows.length > 0,
    `expected ≥1 material recon break from fixture, got rows=${JSON.stringify(rows)}`,
  );

  // ── Step 3: Lock must be blocked — recon light is red ──
  const blocked = await inject(app, 'POST', `/entities/${entity}/period/lock`, { periodId });
  expectErr(blocked, 409, 'LIGHTS_NOT_GREEN');

  // ── Step 4: Dispose every open material break ──
  const openMaterial = materialRows.filter((r) => r.disposition === null || r.disposition.state === 'open');
  assert(openMaterial.length > 0, `no open material breaks to dispose (all already disposed?) — rows=${JSON.stringify(materialRows)}`);

  for (const b of openMaterial) {
    const rawId = encodeReconBreakId(b.wallet, b.coinType);
    const urlId = encodeURIComponent(rawId);
    const dr = await inject(app, 'POST', `/recon-breaks/${urlId}/disposition`, {
      state: 'resolved',
      reasonCode: 'timing',
      periodId,
    });
    assert(dr.status === 200, `disposition of ${rawId} failed: ${JSON.stringify(dr.body)}`);
  }

  // ── Step 5: Re-read recon — openMaterial must be 0 ──
  const recon2 = await inject(app, 'GET', `/entities/${entity}/reconciliation?periodId=${periodId}`);
  assert(recon2.status === 200, `reconciliation re-fetch failed: ${recon2.status}`);

  const rows2: Array<{
    wallet: string;
    coinType: string;
    material: boolean;
    disposition: { state: string } | null;
  }> = recon2.body.rows ?? [];

  const stillOpenMaterial = rows2.filter(
    (r) => r.material === true && (r.disposition === null || r.disposition.state === 'open'),
  );
  assert(
    stillOpenMaterial.length === 0,
    `still ${stillOpenMaterial.length} open material break(s) after disposition: ${JSON.stringify(stillOpenMaterial)}`,
  );

  const summary2 = recon2.body.summary as { material: number; openMaterial: number; balanced: boolean };
  assert(
    summary2.openMaterial === 0,
    `summary.openMaterial should be 0 after disposition, got ${summary2.openMaterial}`,
  );

  // ── Step 6: Lock must now proceed ──
  const ok = await inject(app, 'POST', `/entities/${entity}/period/lock`, { periodId });
  assert(
    ok.status === 200 || ok.status === 201,
    `lock should proceed after disposing all material breaks, got ${ok.status} ${JSON.stringify(ok.body)}`,
  );
  assert(
    ok.body.lock?.status === 'LOCKED',
    `expected lock.status === 'LOCKED', got ${ok.body.lock?.status}`,
  );

  console.log(
    `(S3) recon gate: ${materialRows.length} material break(s) blocked lock → disposed → openMaterial=0 → lock PASSED.`,
  );
}
