/**
 * Task 6: GET /entities/:id/trial-balance and GET /entities/:id/roll-forward read endpoints.
 *
 * WHY these tests matter (Rule 9):
 * - meta (accountingStandard/policySetVersion/periodStatus/generatedAt) is the audit trail a
 *   controller relies on to know WHAT policy produced these numbers and WHETHER the period is
 *   still open to change — a report without it is unauditable.
 * - drift is the fail-loud guard from spec ruling 4: once a period is LOCKED, the cockpit's
 *   'je' light was frozen as evidence. If someone mutates journal_entries directly after lock
 *   (bypassing the app layer — e.g. an ops raw SQL fix), the frozen light and the recomputed
 *   tie-out will disagree. Silently trusting the recomputed number would hide that the signed-off
 *   evidence no longer matches reality; silently trusting the frozen light would hide a real
 *   current imbalance. Both are wrong — the endpoint must surface the disagreement instead.
 * - the malformed-periodId monkey test locks in that this is a 400, not a 500: periodCutoff
 *   throws a bare Error on bad input, and an unhandled route throw becomes an ugly 500 leak.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import { registerAcmeFixtureAssets } from './helpers/registerTestAsset.js';
import { makeRevaluationGreen } from './helpers/revaluation.js';
import { upsertReconDisposition } from '../src/store/reconBreakStore.js';
import type { Db } from '../src/store/db.js';

const P = '2026-Q2';

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

interface Ctx { app: FastifyInstance & { _db: Db }; db: Db }

async function seedAndRunRules(ctx: Ctx): Promise<void> {
  const { app, db } = ctx;
  await app.inject({ method: 'POST', url: `/entities/${TEST_ENTITY_ID}/ingest`, payload: {} });
  await app.inject({ method: 'POST', url: `/entities/${TEST_ENTITY_ID}/run-rules`, payload: { periodId: P } });
  dismissReconBreaks(db, TEST_ENTITY_ID, P);
  registerAcmeFixtureAssets(db, TEST_ENTITY_ID);
}

async function lockPeriod(ctx: Ctx): Promise<void> {
  const { app } = ctx;
  await makeRevaluationGreen(app, TEST_ENTITY_ID, P);
  const lockR = await app.inject({ method: 'POST', url: `/entities/${TEST_ENTITY_ID}/period/lock`, payload: { periodId: P } });
  if (lockR.statusCode !== 200) {
    throw new Error(`lockPeriod: lock failed ${lockR.statusCode} ${lockR.body}`);
  }
}

describe('GET /entities/:id/trial-balance', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    const app = await buildTestApp();
    ctx = { app, db: app._db };
    await seedAndRunRules(ctx);
  });

  it('200: rows + tieOut + meta (standard/policySetVersion/periodStatus/generatedAt all present)', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/trial-balance?periodId=${P}` });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.tieOut).toBeDefined();
    expect(typeof body.tieOut.balanced).toBe('boolean');
    expect(body.meta.accountingStandard).toBeDefined();
    expect(body.meta.policySetVersion).toBeDefined();
    expect(body.meta.periodStatus).toBe('OPEN');
    expect(typeof body.meta.generatedAt).toBe('string');
  });

  it('400 PERIOD_ID_REQUIRED: missing periodId', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/trial-balance` });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('PERIOD_ID_REQUIRED');
  });

  it('404: unknown entity', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: `/entities/nope/trial-balance?periodId=${P}` });
    expect(r.statusCode).toBe(404);
  });

  it('OPEN period: drift=null', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/trial-balance?periodId=${P}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().drift).toBeNull();
  });

  it('LOCKED period, ledger untouched: drift=null', async () => {
    await lockPeriod(ctx);
    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/trial-balance?periodId=${P}` });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.meta.periodStatus).toBe('LOCKED');
    expect(body.drift).toBeNull();
  });

  it('LOCKED then a raw-INSERT JE unbalances tie-out -> drift.code=LIGHTS_SNAPSHOT_DRIFT (ruling 4 fail-loud)', async () => {
    await lockPeriod(ctx);
    // Simulate a post-lock direct-DB edit (bypassing the app layer entirely): insert an event +
    // an UNBALANCED journal entry (a lone debit, no offsetting credit).
    ctx.db.prepare(
      `INSERT INTO events (id, entity_id, raw_json, status, final_event_type, period_id)
       VALUES ('drift-ev', ?, '{}', 'POSTED', 'MANUAL_ADJUSTMENT', ?)`,
    ).run(TEST_ENTITY_ID, P);
    const jeJson = JSON.stringify({ status: 'POSTED', lines: [{ account: 'cash', side: 'DEBIT', amountMinor: '999' }] });
    ctx.db.prepare(
      `INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id)
       VALUES ('drift-je', ?, 'drift-ev', ?, 'idem-drift', 'hash-drift', ?)`,
    ).run(TEST_ENTITY_ID, jeJson, P);

    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/trial-balance?periodId=${P}` });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.tieOut.balanced).toBe(false);
    expect(body.drift).toEqual({ code: 'LIGHTS_SNAPSHOT_DRIFT', frozenJeStatus: 'green', recomputedBalanced: false });
  });

  it('LOCKED then a raw-UPDATE swaps two debit amounts across two JEs (aggregate preserved, per-JE broken) -> drift non-null (final review I-1: lockedDrift must re-check per-JE balance, not just tieOut)', async () => {
    await lockPeriod(ctx);
    // Two brand-new, individually-balanced JEs inserted post-lock.
    ctx.db.prepare(
      `INSERT INTO events (id, entity_id, raw_json, status, final_event_type, period_id)
       VALUES ('swap-ev-a', ?, '{}', 'POSTED', 'MANUAL_ADJUSTMENT', ?)`,
    ).run(TEST_ENTITY_ID, P);
    ctx.db.prepare(
      `INSERT INTO events (id, entity_id, raw_json, status, final_event_type, period_id)
       VALUES ('swap-ev-b', ?, '{}', 'POSTED', 'MANUAL_ADJUSTMENT', ?)`,
    ).run(TEST_ENTITY_ID, P);
    // Uses ACCOUNT_SEED-mapped accounts (DigitalAssets/AccountsPayable), not an unknown-class
    // account: an unknown account class would already fail tieOut.balanced on its own (trialBalance
    // fails closed on unmapped accounts), which would defeat the "aggregate preserved" premise here.
    const jeA = { status: 'POSTED', lines: [{ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '500' }, { account: 'AccountsPayable', side: 'CREDIT', amountMinor: '500' }] };
    const jeB = { status: 'POSTED', lines: [{ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '300' }, { account: 'AccountsPayable', side: 'CREDIT', amountMinor: '300' }] };
    ctx.db.prepare(
      `INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id)
       VALUES ('swap-je-a', ?, 'swap-ev-a', ?, 'idem-swap-a', 'hash-swap-a', ?)`,
    ).run(TEST_ENTITY_ID, JSON.stringify(jeA), P);
    ctx.db.prepare(
      `INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id)
       VALUES ('swap-je-b', ?, 'swap-ev-b', ?, 'idem-swap-b', 'hash-swap-b', ?)`,
    ).run(TEST_ENTITY_ID, JSON.stringify(jeB), P);

    // Now swap the two DEBIT amounts across the JEs: JE-A debit becomes 300 (credit stays 500),
    // JE-B debit becomes 500 (credit stays 300). Aggregate ΣDr=ΣCr=800 is preserved (still ties
    // out), and Σsigned-closing is unaffected (same accounts, same total flow) — but each JE is
    // now individually unbalanced. A tieOut-only re-check cannot see this; a per-JE sweep can.
    const jeASwapped = { status: 'POSTED', lines: [{ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '300' }, { account: 'AccountsPayable', side: 'CREDIT', amountMinor: '500' }] };
    const jeBSwapped = { status: 'POSTED', lines: [{ account: 'DigitalAssets', side: 'DEBIT', amountMinor: '500' }, { account: 'AccountsPayable', side: 'CREDIT', amountMinor: '300' }] };
    ctx.db.prepare('UPDATE journal_entries SET je_json = ? WHERE id = ?').run(JSON.stringify(jeASwapped), 'swap-je-a');
    ctx.db.prepare('UPDATE journal_entries SET je_json = ? WHERE id = ?').run(JSON.stringify(jeBSwapped), 'swap-je-b');

    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/trial-balance?periodId=${P}` });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    // Aggregate tie-out still balances — this is exactly the case a tieOut-only re-check misses.
    expect(body.tieOut.balanced).toBe(true);
    expect(body.drift).not.toBeNull();
    expect(body.drift.code).toBe('LIGHTS_SNAPSHOT_DRIFT');
  });

  it('monkey: malformed periodId -> 400 INVALID_PERIOD (not 500)', async () => {
    for (const bad of ['2026-13', 'garbage']) {
      const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/trial-balance?periodId=${bad}` });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('INVALID_PERIOD');
    }
  });

  it('legal periodId + data corruption (illegal amountMinor JE) -> 500 INTERNAL, not 400 INVALID_PERIOD (review Important)', async () => {
    // Simulate a raw-INSERT data-integrity fault unrelated to periodId format: buildTrialBalance
    // throws a bare Error on a non-numeric amountMinor. Before the fix this was caught by the
    // route's try/catch (which wrapped the whole builder call) and mis-reported as 400
    // INVALID_PERIOD — masking a server-side data fault as a client input error.
    ctx.db.prepare(
      `INSERT INTO events (id, entity_id, raw_json, status, final_event_type, period_id)
       VALUES ('corrupt-ev', ?, '{}', 'POSTED', 'MANUAL_ADJUSTMENT', ?)`,
    ).run(TEST_ENTITY_ID, P);
    const badJeJson = JSON.stringify({ status: 'POSTED', lines: [{ account: 'cash', side: 'DEBIT', amountMinor: 'not-a-number' }] });
    ctx.db.prepare(
      `INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id)
       VALUES ('corrupt-je', ?, 'corrupt-ev', ?, 'idem-corrupt', 'hash-corrupt', ?)`,
    ).run(TEST_ENTITY_ID, badJeJson, P);

    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/trial-balance?periodId=${P}` });
    expect(r.statusCode).toBe(500);
    expect(r.json().error.code).toBe('INTERNAL'); // deterministic fallback code (routes.ts global handler), not INVALID_PERIOD
  });
});

describe('GET /entities/:id/roll-forward', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    const app = await buildTestApp();
    ctx = { app, db: app._db };
    await seedAndRunRules(ctx);
  });

  it('200: GAAP track full shape + meta', async () => {
    const patchR = await ctx.app.inject({
      method: 'PATCH', url: '/policy/policy-set',
      payload: { entity: TEST_ENTITY_ID, actor: 'cpa', reason: 'adopt ASU 2023-08', changes: { accountingStandard: 'US_GAAP', asu202308Applies: {} } },
    });
    expect(patchR.statusCode).toBe(200);
    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/roll-forward?periodId=${P}` });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.notApplicable).toBe(false);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.meta.accountingStandard).toBe('US_GAAP');
    expect(typeof body.meta.generatedAt).toBe('string');
  });

  it('200: IFRS track notApplicable + meta', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/roll-forward?periodId=${P}` });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.notApplicable).toBe(true);
    expect(body.meta.accountingStandard).toBe('IFRS');
  });

  it('400 PERIOD_ID_REQUIRED: missing periodId', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/roll-forward` });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('PERIOD_ID_REQUIRED');
  });

  it('404: unknown entity', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: `/entities/nope/roll-forward?periodId=${P}` });
    expect(r.statusCode).toBe(404);
  });

  it('monkey: malformed periodId -> 400 INVALID_PERIOD (not 500), even on the IFRS early-return track', async () => {
    for (const bad of ['2026-13', 'garbage']) {
      const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/roll-forward?periodId=${bad}` });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('INVALID_PERIOD');
    }
  });

  it('legal periodId + corrupt active policy_sets doc -> 503 POLICY_CORRUPT, not 400 INVALID_PERIOD (review Important)', async () => {
    // Append-only store: policy_sets rows are never updated, so simulate corruption by inserting
    // a new (higher-version, therefore "active") row with a non-JSON doc. buildRollForward's
    // getActivePolicy call throws PolicyPersistenceError('POLICY_CORRUPT', ...), which the global
    // error handler maps to 503. Before the fix, the route's try/catch wrapped the whole
    // buildRollForward call and mis-reported this as 400 INVALID_PERIOD — masking a server-side
    // policy-store fault as a client input error.
    const cur = ctx.db.prepare('SELECT MAX(version) AS v FROM policy_sets WHERE entity_id = ?')
      .get(TEST_ENTITY_ID) as { v: number };
    ctx.db.prepare(
      `INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by)
       VALUES (?, ?, 'not-json', ?, 'test')`,
    ).run(TEST_ENTITY_ID, cur.v + 1, new Date().toISOString());

    const r = await ctx.app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/roll-forward?periodId=${P}` });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('POLICY_CORRUPT');
  });
});
