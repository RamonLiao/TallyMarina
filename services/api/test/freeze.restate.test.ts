/**
 * Regression test for the freeze-route 409 dead-end: reopen → edit → re-lock →
 * re-freeze must produce a NEW snapshot version (seq+1, supersedesSeq=prev.seq)
 * instead of SNAPSHOT_CONFLICT. See .superpowers/sdd/task-3-brief.md.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/store/db.js';
import { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import { registerAcmeFixtureAssets } from './helpers/registerTestAsset.js';
import { makeRevaluationGreen } from './helpers/revaluation.js';
import { upsertReconDisposition } from '../src/store/reconBreakStore.js';
import { getSnapshot } from '../src/store/snapshotStore.js';

const PERIOD_ID = '2026-Q2';

// Fixture recon breaks that must be dismissed before the period's lights go green.
const RECON_BREAKS = [
  '0xacmeTreasury|0x2::sui::SUI',
  '0xacmeTreasury|0xbeef::usdc::USDC',
  '0xacmeTreasury|0xcafe::weth::WETH',
  '0xacmeTreasury|0xdead::usdt::USDT',
];

function dismissReconBreaks(db: Db, entityId: string, periodId: string) {
  for (const key of RECON_BREAKS) {
    const [wallet, coinType] = key.split('|') as [string, string];
    upsertReconDisposition(db, {
      entityId, periodId, wallet, coinType, state: 'dismissed',
      reasonCode: 'unidentified', reasonNote: null, decidedBy: 'test', decidedAt: Date.now(),
    });
  }
}

interface Ctx { app: FastifyInstance & { _db: Db }; db: Db; entityId: string; periodId: string }

async function seedLockedPeriodWithJE(ctx: Ctx) {
  const { app, db, entityId, periodId } = ctx;
  await app.inject({ method: 'POST', url: `/entities/${entityId}/ingest`, payload: {} });
  await app.inject({ method: 'POST', url: `/entities/${entityId}/run-rules`, payload: { periodId } });
  dismissReconBreaks(db, entityId, periodId);
  registerAcmeFixtureAssets(db, entityId); // registry close-gate precondition (assets have known scale)
  await makeRevaluationGreen(app, entityId, periodId); // Task 7: revaluation light precondition
  const lockR = await app.inject({ method: 'POST', url: `/entities/${entityId}/period/lock`, payload: { periodId } });
  if (lockR.statusCode !== 200) {
    throw new Error(`seedLockedPeriodWithJE: lock failed ${lockR.statusCode} ${lockR.body}`);
  }
}

async function reopenAndEditJE(
  ctx: Ctx,
  opts: { reasonCode?: string; restatementReason?: string } = {},
) {
  const { app, db, entityId, periodId } = ctx;
  const reopenR = await app.inject({
    method: 'POST', url: `/entities/${entityId}/period/reopen`,
    payload: {
      periodId,
      restatementReason: opts.restatementReason ?? 'late-arriving info',
      reasonCode: opts.reasonCode ?? 'LATE_ARRIVING_TXN',
    },
  });
  if (reopenR.statusCode !== 200) {
    throw new Error(`reopenAndEditJE: reopen failed ${reopenR.statusCode} ${reopenR.body}`);
  }

  // Mutate one journal_entries row so the merkle root changes: bump the DEBIT
  // and CREDIT line by the same amount so the JE (and TB) stay balanced — the
  // cockpit's 'je' light (tie-out) must stay green through re-lock.
  const row = db.prepare(
    'SELECT id, je_json FROM journal_entries WHERE entity_id = ? AND period_id = ? LIMIT 1',
  ).get(entityId, periodId) as { id: string; je_json: string };
  const je = JSON.parse(row.je_json) as { lines: Array<{ side: 'DEBIT' | 'CREDIT'; amountMinor: string }> };
  const debit = je.lines.find((l) => l.side === 'DEBIT')!;
  const credit = je.lines.find((l) => l.side === 'CREDIT')!;
  debit.amountMinor = String(BigInt(debit.amountMinor) + 1n);
  credit.amountMinor = String(BigInt(credit.amountMinor) + 1n);
  db.prepare('UPDATE journal_entries SET je_json = ? WHERE id = ?').run(JSON.stringify(je), row.id);

  dismissReconBreaks(db, entityId, periodId);
  const lockR = await app.inject({ method: 'POST', url: `/entities/${entityId}/period/lock`, payload: { periodId } });
  if (lockR.statusCode !== 200) {
    throw new Error(`reopenAndEditJE: re-lock failed ${lockR.statusCode} ${lockR.body}`);
  }
}

describe('freeze restatement (409 dead-end fix)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    const app = await buildTestApp();
    ctx = { app, db: app._db, entityId: TEST_ENTITY_ID, periodId: PERIOD_ID };
  });

  it('reopen → edit → re-lock → re-freeze produces seq=2/supersedesSeq=1, NOT SNAPSHOT_CONFLICT', async () => {
    const { app, entityId, periodId } = ctx;
    await seedLockedPeriodWithJE(ctx);
    const first = await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    expect(first.statusCode).toBe(200);
    expect(first.json().snapshot.seq).toBe(1);
    expect(first.json().snapshot.supersedesSeq).toBe(0); // DTO renders null as 0

    await reopenAndEditJE(ctx); // reopen, mutate a JE amount, re-lock

    const second = await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    expect(second.statusCode).toBe(200);            // was 409 SNAPSHOT_CONFLICT before the fix
    expect(second.json().snapshot.seq).toBe(2);
    expect(second.json().snapshot.supersedesSeq).toBe(1);
  });

  it('same-books re-freeze is idempotent (no new seq)', async () => {
    const { app, entityId, periodId } = ctx;
    await seedLockedPeriodWithJE(ctx);
    const a = await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    const b = await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    expect(a.json().snapshot.seq).toBe(1);
    expect(b.json().snapshot.seq).toBe(1);          // idempotent, same row
  });

  it('restate row carries provenance snapshotted from period_lock reopen', async () => {
    const { app, db, entityId, periodId } = ctx;
    await seedLockedPeriodWithJE(ctx);
    await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    await reopenAndEditJE(ctx, { reasonCode: 'ERROR_CORRECTION', restatementReason: 'wrong FX' });
    await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    expect(getSnapshot(db, `snap-${entityId}-${periodId}-2`)!.restatementReasonCode).toBe('ERROR_CORRECTION');
  });
});
