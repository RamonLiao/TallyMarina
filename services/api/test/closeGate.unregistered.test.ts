// services/api/test/closeGate.unregistered.test.ts
//
// The registry half of the close gate. An asset whose scale we have not registered is not a UI
// copy problem — it is a state we must not close over, because every number we compute for it
// (its break, whether that break is "material") is measured against a scale we do not have.
//
// `unregisteredAsset` is orthogonal to `material` AND to disposition state. The most important
// test here is the orthogonality one: a *dismissed* break at an unknown scale must still block,
// because "someone decided this break" and "we know this asset's scale" are two different
// questions, and folding them into one predicate lets a cosmetic dismiss erase a control gap.
//
// Five backend call sites are pinned here, each by its own assertion, so the mutation check can
// remove any one site and see exactly one assertion turn red:
//   1. unregisteredAssetBlockers  — the predicate            (describe 'unregisteredAssetBlockers')
//   2. GET /close-readiness       — registry.blocking        (describe 'close-readiness registry gate')
//   3. POST /snapshot             — 409 code                 (describe 'snapshot registry gate')
//   4. reconDTO summary tally     — summary.unregistered     (describe 'reconDTO registry tally')
//   5. cockpit registry light     — lights[key='registry']   (describe 'cockpit registry light')
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { unregisteredAssetBlockers } from '../src/reconciliation/collect.js';
import { applyReconDisposition } from '../src/reconciliation/disposition.js';
import { loadReconFixture } from '../src/reconciliation/fixture.js';
import { buildCockpit } from '../src/periodLock/cockpit.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';
import { ensurePolicySeed } from '../src/store/policyStore.js';

const EID = 'acme:pilot-001';
const PERIOD = '2026-Q2';

// The four assets acme:pilot-001's recon fixture actually references. NOT five: 0xface::tok::TOK
// belongs to opening-lot-recon-test:entity, a different entity, and must never appear here.
const ALL = [
  ['0x2::sui::SUI', 9], ['0xbeef::usdc::USDC', 6],
  ['0xcafe::weth::WETH', 8], ['0xdead::usdt::USDT', 6],
] as const;

const tmpDirs: string[] = [];
function freshDb(): Db {
  const dir = mkdtempSync(join(tmpdir(), 'closegate-')); tmpDirs.push(dir);
  const db = openDb(join(dir, 'test.db'));
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('acme:pilot-001','ACME','0xc','0xcap','0xpkg')`).run();
  // Raw SQL bypasses insertEntity's ensurePolicySeed call (Task 3 read-path switchover
  // requires every entity have a persisted policy row) — re-run it explicitly.
  ensurePolicySeed(db);
  return db;
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

function registerAll(db: Db): void {
  for (const [ct, dp] of ALL) registerTestAsset(db, EID, ct, dp);
}

function lockPeriod(db: Db): void {
  db.prepare(
    `INSERT INTO period_lock (entity_id, period_id, status, locked_at, locked_by, lights_snapshot, reopen_count)
     VALUES (?, ?, 'LOCKED', 0, 'test', '[]', 0)`,
  ).run(EID, PERIOD);
}

// Dismiss every fixture break. This clears the recon (material-break) half of the gate so the
// registry half is tested in isolation — and doubles as the orthogonality assertion at the route
// level: a dismissed break at an unknown scale must STILL block.
function dismissAllBreaks(db: Db): void {
  for (const row of loadReconFixture(EID)) {
    applyReconDisposition(db, {
      entityId: EID, periodId: PERIOD, wallet: row.wallet, coinType: row.coinType,
      to: 'dismissed', reasonCode: 'error', reasonNote: null, decidedBy: 'test', now: 1,
    });
  }
}

async function buildApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify();
  registerRoutes(app, {
    db,
    cfg: { reconLiveWallet: '0xreal', explorerBase: 'https://x' } as never,
    classifyClient: {} as never, copilotClient: {} as never,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    memory: new OffMemory(),
  });
  await app.ready();
  return app;
}

describe('unregisteredAssetBlockers', () => {
  it('blocks close for every unregistered asset in the fixture (4, not 5)', () => {
    const db = freshDb();
    expect(unregisteredAssetBlockers(db, EID, PERIOD)).toHaveLength(4);
  });

  it('clears once every asset is registered', () => {
    const db = freshDb();
    registerAll(db);
    expect(unregisteredAssetBlockers(db, EID, PERIOD)).toHaveLength(0);
  });

  it('is orthogonal to disposition — a dismissed break with unknown scale still blocks', () => {
    // WHY (D12): "someone decided this break" and "we know this asset's scale" are different
    // questions. Folding them into one predicate (b.unregisteredAsset && blocksClose(...)) lets a
    // cosmetic dismiss clear a control gap: the amount was decided at a scale we cannot read, so
    // the dismissal decided nothing. wallet+coinType match the real fixture row so the folded
    // mutation would actually find this disposition and (wrongly) filter the asset out.
    const db = freshDb();
    db.prepare(`INSERT INTO recon_break_disposition (entity_id, period_id, wallet, coin_type, state, reason_code, reason_note, decided_by, decided_at)
                VALUES ('acme:pilot-001','2026-Q2','0xacmeTreasury','0xbeef::usdc::USDC','dismissed','fee',NULL,'a',1)`).run();
    expect(unregisteredAssetBlockers(db, EID, PERIOD).some((b) => b.coinType.includes('usdc'))).toBe(true);
  });
});

describe('close-readiness registry gate (call site 2)', () => {
  it('reports registry.blocking and closeable:false even when the recon gate is clear', async () => {
    // Isolation: dismiss all breaks so recon.blocking === 0. If close-readiness stops consulting
    // unregisteredAssetBlockers, `registry` vanishes and closeable flips to true — this test alone
    // turns red, while snapshot/cockpit/reconDTO stay green.
    const db = freshDb();
    dismissAllBreaks(db);
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: `/entities/${EID}/close-readiness` });
    const body = res.json();
    expect(body.recon.blocking).toBe(0);      // guard: the recon half really is clear
    expect(body.registry.blocking).toBe(4);
    expect(body.closeable).toBe(false);
    await app.close();
  });

  it('is closeable once every asset is registered and every break decided', async () => {
    const db = freshDb();
    registerAll(db);
    dismissAllBreaks(db);
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: `/entities/${EID}/close-readiness` });
    const body = res.json();
    expect(body.registry.blocking).toBe(0);
    expect(body.closeable).toBe(true);
    await app.close();
  });
});

describe('snapshot registry gate (call site 3)', () => {
  it('409 UNREGISTERED_ASSETS_BLOCKING when a dismissed break still has unknown scale', async () => {
    // Reaches the registry gate only because the recon gate is cleared (dismissed). If the snapshot
    // registry check is removed, the freeze proceeds to the empty-JE guard and 409s with
    // EMPTY_SNAPSHOT instead — a different code, so asserting the exact code pins this site.
    const db = freshDb();
    lockPeriod(db);
    dismissAllBreaks(db);
    const app = await buildApp(db);
    const res = await app.inject({ method: 'POST', url: `/entities/${EID}/snapshot`, payload: { periodId: PERIOD } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('UNREGISTERED_ASSETS_BLOCKING');
    await app.close();
  });
});

describe('reconDTO registry tally (call site 4)', () => {
  it('summary.unregistered counts unregistered assets and drops to 0 once registered', async () => {
    const db = freshDb();
    const app = await buildApp(db);
    const before = await app.inject({ method: 'GET', url: `/entities/${EID}/reconciliation` });
    expect(before.json().summary.unregistered).toBe(4);
    await app.close();

    registerAll(db);
    const app2 = await buildApp(db);
    const after = await app2.inject({ method: 'GET', url: `/entities/${EID}/reconciliation` });
    expect(after.json().summary.unregistered).toBe(0);
    await app2.close();
  });
});

describe('cockpit registry light (call site 5)', () => {
  it('is red/real while any asset is unregistered and green once all are registered', () => {
    const db = freshDb();
    const red = buildCockpit(db, EID, PERIOD, 0.7).lights.find((l) => l.key === 'registry')!;
    expect(red.status).toBe('red');
    expect(red.real).toBe(true);

    registerAll(db);
    const green = buildCockpit(db, EID, PERIOD, 0.7).lights.find((l) => l.key === 'registry')!;
    expect(green.status).toBe('green');
  });
});
