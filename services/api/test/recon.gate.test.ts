// services/api/test/recon.gate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { ensurePolicySeed } from '../src/store/policyStore.js';

function seedEntity(db: Db) {
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
  // Raw SQL bypasses insertEntity's ensurePolicySeed call (Task 3 read-path switchover
  // requires every entity have a persisted policy row) — re-run it explicitly.
  ensurePolicySeed(db);
}

describe('recon close gate', () => {
  let db: Db; let app: FastifyInstance;
  beforeEach(async () => {
    db = openDb(':memory:'); seedEntity(db);
    app = Fastify();
    registerRoutes(app, { db, cfg: { reconLiveWallet: '0xreal', explorerBase: 'https://x' } as never, classifyClient: {} as never, copilotClient: {} as never, anchorAdapter: null as never, mutex: { run: (_k: string, fn: () => Promise<never>) => fn() }, memory: new OffMemory() });
    await app.ready();
  });

  it('open material recon break blocks freeze with RECON_BREAKS_BLOCKING', async () => {
    // WHY: PERIOD_NOT_LOCKED is now the first gate (before recon) — we must lock first
    // so we can verify the recon gate is the one that blocks (not the period-lock gate).
    // Force-insert a LOCKED period_lock row so only the recon gate is tested here.
    db.prepare(
      `INSERT INTO period_lock (entity_id, period_id, status, locked_at, locked_by, lights_snapshot, reopen_count)
       VALUES ('acme:pilot-001', '2026-Q2', 'LOCKED', 0, 'test', '[]', 0)`,
    ).run();
    // No JEs → USDC/WETH/USDT fixture breaks are material & open → must block.
    const res = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/snapshot', payload: { periodId: '2026-Q2' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('RECON_BREAKS_BLOCKING');
  });

  it('close-readiness returns {exceptions, recon, closeable}', async () => {
    const res = await app.inject({ method: 'GET', url: '/entities/acme:pilot-001/close-readiness' });
    const body = res.json();
    expect(body).toHaveProperty('exceptions.blocking');
    expect(body).toHaveProperty('recon.blocking');
    expect(body.closeable).toBe(false); // recon material breaks open
  });
});

describe('recon gate — fixture-less entity', () => {
  let db: Db; let app: FastifyInstance;
  beforeEach(async () => {
    db = openDb(':memory:');
    // 'other:entity' exists but has NO recon fixture in the fixture file
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('other:entity','Other','0x10','0x20','0x30')").run();
    ensurePolicySeed(db);
    app = Fastify();
    registerRoutes(app, { db, cfg: { reconLiveWallet: '0xreal', explorerBase: 'https://x' } as never, classifyClient: {} as never, copilotClient: {} as never, anchorAdapter: null as never, mutex: { run: (_k: string, fn: () => Promise<never>) => fn() }, memory: new OffMemory() });
    await app.ready();
  });

  it('close-readiness for fixture-less entity returns 200 with recon.blocking=0', async () => {
    // WHY: missing fixture = not configured → recon gate vacuously satisfied, must not 500
    const res = await app.inject({ method: 'GET', url: '/entities/other:entity/close-readiness' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recon.blocking).toBe(0);
  });

  it('GET /reconciliation for fixture-less entity returns 200 with empty rows', async () => {
    // WHY: fixture-less entity should return empty reconciliation, not 500
    const res = await app.inject({ method: 'GET', url: '/entities/other:entity/reconciliation' });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toEqual([]);
  });

  it('snapshot freeze for fixture-less entity with no exceptions is not blocked by recon', async () => {
    // WHY: missing fixture contributes 0 recon blockers; if exceptions also clear, should allow
    const res = await app.inject({ method: 'POST', url: '/entities/other:entity/snapshot', payload: { periodId: '2026-Q2' } });
    // 409 is possible if exceptions block (state machine); but NOT due to RECON_BREAKS_BLOCKING
    if (res.statusCode === 409) {
      expect(res.json().error?.code).not.toBe('RECON_BREAKS_BLOCKING');
    }
    expect(res.statusCode).not.toBe(500);
  });
});
