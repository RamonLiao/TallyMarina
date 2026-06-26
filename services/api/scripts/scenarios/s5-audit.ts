import { buildApp, inject, assert, stubClassify } from './harness.js';
import { runPipeline } from './pipeline.js';
import { listJournal } from '../../src/store/journalStore.js';
import { recomputeRoot } from '../../../../web/src/lib/proofVerify.js';

export async function run(): Promise<void> {
  const hasSigner = !!process.env.SUI_PK;
  const { app, db, cfg } = await buildApp({ realChain: hasSigner });
  const entity = encodeURIComponent(cfg.entityId);
  const periodId = '2026-Q2';

  // ── Pipeline: classify → journal → snapshot ──
  await runPipeline(db, cfg, stubClassify, { periodId });

  // ── Get first journal row (has leafHash) ──
  const rows = listJournal(db, cfg.entityId);
  assert(rows.length > 0, 'no journal entries found after pipeline');
  const row = rows[0];

  // ── Fetch inclusion proof from /anchors ──
  const res = await inject(
    app,
    'GET',
    `/entities/${entity}/anchors?idempotencyKey=${encodeURIComponent(row.idempotencyKey)}`,
  );
  assert(res.status === 200, `anchors fetch failed: ${res.status} ${JSON.stringify(res.body)}`);
  const proof = res.body.inclusionProof;
  assert(proof != null, `no inclusionProof in response: ${JSON.stringify(res.body)}`);
  assert(Array.isArray(proof.siblings), `proof.siblings missing: ${JSON.stringify(proof)}`);
  assert(typeof proof.merkleRoot === 'string', `proof.merkleRoot missing: ${JSON.stringify(proof)}`);

  // ── Happy path: recompute from journal leafHash must match claimed merkleRoot ──
  const root = await recomputeRoot(row.leafHash, proof.siblings);
  assert(
    root === proof.merkleRoot.toLowerCase(),
    `proof recompute mismatch: ${root} ≠ ${proof.merkleRoot.toLowerCase()}`,
  );

  // ── Tamper-negative: flip last hex char → recompute must NOT match ──
  const tamperedLeaf = row.leafHash.replace(/.$/, (c: string) => (c === '0' ? '1' : '0'));
  const badRoot = await recomputeRoot(tamperedLeaf, proof.siblings);
  assert(
    badRoot !== proof.merkleRoot.toLowerCase(),
    'tampered leaf still verified — proof has no detective value',
  );

  console.log('(S5) lineage proof recompute verified + tamper rejected');
}
