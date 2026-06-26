import { buildApp, inject, assert, stubClassify } from './harness.js';
import { runPipeline } from './pipeline.js';
import { listJournal } from '../../src/store/journalStore.js';
import type { JournalEntry } from '../../src/deps/rulesEngine.js';

export async function run(): Promise<void> {
  const hasSigner = !!process.env.SUI_PK;
  const { app, db, cfg, grpc } = await buildApp({ realChain: hasSigner });
  const entity = encodeURIComponent(cfg.entityId);
  const periodId = '2026-Q2';

  // ── Pipeline: classify → journal → snapshot ──
  const { snapId } = await runPipeline(db, cfg, stubClassify, { periodId });

  // ── Accounting invariants ──
  const jeRows = listJournal(db, cfg.entityId);
  assert(jeRows.length > 0, 'no journal entries posted');

  const jes = jeRows.map((r) => JSON.parse(r.jeJson) as JournalEntry);

  // Every JE must balance: Σ DEBIT == Σ CREDIT
  for (const je of jes) {
    const dr = je.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const cr = je.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    assert(dr === cr, `JE ${je.idempotencyKey} unbalanced: DEBIT ${dr} ≠ CREDIT ${cr}`);
  }

  // Trial balance nets to zero across all legs
  const tb = jes.flatMap((j) => j.lines)
    .reduce((s, l) => s + (l.side === 'DEBIT' ? BigInt(l.amountMinor) : -BigInt(l.amountMinor)), 0n);
  assert(tb === 0n, `trial balance does not net to zero: ${tb}`);

  // Review-queue must be drained: { events: [] }
  const rq = await inject(app, 'GET', `/entities/${entity}/review-queue`);
  assert(rq.status === 200, `review-queue failed: ${rq.status}`);
  const rqItems: unknown[] = Array.isArray(rq.body) ? rq.body : (rq.body.events ?? []);
  assert(rqItems.length === 0, `review-queue not drained: ${rqItems.length} item(s)`);

  // No orphan NEEDS_REVIEW events at freeze
  const evRes = await inject(app, 'GET', `/entities/${entity}/events`);
  assert(evRes.status === 200, `events fetch failed: ${evRes.status}`);
  const allEvents: Array<{ status: string }> = Array.isArray(evRes.body) ? evRes.body : (evRes.body.events ?? []);
  const needsReview = allEvents.filter((e) => e.status === 'NEEDS_REVIEW');
  assert(needsReview.length === 0, `orphan NEEDS_REVIEW events at freeze: ${needsReview.length}`);

  // ── Dismiss open material recon breaks (required for reconLight green) ──
  const reconRes = await inject(app, 'GET', `/entities/${entity}/reconciliation?periodId=${periodId}`);
  assert(reconRes.status === 200, `reconciliation fetch failed: ${reconRes.status}`);
  const reconRows: Array<{ wallet: string; coinType: string; material: boolean; disposition: unknown }> =
    reconRes.body.rows ?? [];

  for (const b of reconRows) {
    if (!b.material || b.disposition !== null) continue;
    const breakId = encodeURIComponent(`${b.wallet}|${b.coinType}`);
    const dispRes = await inject(app, 'POST', `/recon-breaks/${breakId}/disposition`, {
      state: 'dismissed',
      reasonCode: 'timing',
      periodId,
    });
    assert(dispRes.status === 200, `dismiss recon break ${b.wallet}|${b.coinType} failed: ${JSON.stringify(dispRes.body)}`);
  }

  // ── Lock period ──
  const lockRes = await inject(app, 'POST', `/entities/${entity}/period/lock`, { periodId });
  assert(lockRes.status === 200, `period lock failed: ${JSON.stringify(lockRes.body)}`);
  assert(lockRes.body.lock?.status === 'LOCKED', `expected LOCKED, got ${lockRes.body.lock?.status}`);

  if (!hasSigner) {
    console.log('(S1) SUI_PK unset → verified pipeline through journal+snapshot+lock; anchor skipped.');
    return;
  }

  // ── Chain write (SUI_PK-gated) ──
  const prep = await inject(app, 'POST', `/entities/${entity}/anchor/prepare`, {
    snapshotId: snapId, walletAddress: grpc!.walletAddress,
  });
  assert(prep.status === 200, `prepare failed: ${JSON.stringify(prep.body)}`);

  const { Transaction } = await import('@mysten/sui/transactions');
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
  const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');
  const { secretKey } = decodeSuiPrivateKey(process.env.SUI_PK!);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const result = await grpc!.grpc.signAndExecuteTransaction({
    transaction: Transaction.from(prep.body.txKind), signer: keypair,
  });
  const digest = (result as unknown as { digest: string }).digest;
  assert(digest, 'no digest from sign+execute');

  const conf = await inject(app, 'POST', `/entities/${entity}/anchor/confirm`, {
    snapshotId: snapId, digest, expectedSeq: prep.body.expectedSeq,
  });
  assert(conf.status === 200, `confirm failed: ${JSON.stringify(conf.body)}`);
  assert(typeof conf.body.anchor?.link === 'string' && conf.body.anchor?.seq >= 1, 'anchor confirm missing link/seq');
  console.log(`(S1) ANCHORED seq=${conf.body.anchor.seq} digest=${digest}`);
}
