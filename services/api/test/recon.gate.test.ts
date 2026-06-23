// services/api/test/recon.gate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';

function seedEntity(db: Db) {
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
}

describe('recon close gate', () => {
  let db: Db; let app: FastifyInstance;
  beforeEach(async () => {
    db = openDb(':memory:'); seedEntity(db);
    app = Fastify();
    registerRoutes(app, { db, cfg: { reconLiveWallet: '0xreal', explorerBase: 'https://x' } as never, classifyClient: {} as never, copilotClient: {} as never, anchorAdapter: null as never, mutex: { run: (_k: string, fn: () => Promise<never>) => fn() } });
    await app.ready();
  });

  it('open material recon break blocks freeze with RECON_BREAKS_BLOCKING', async () => {
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
