// services/api/test/recon.monkey.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { applyReconDisposition } from '../src/reconciliation/disposition.js';
import { validateReconRows } from '../src/reconciliation/fixture.js';

// ---------------------------------------------------------------------------
// App factory — matches shape from recon.routes.test.ts
// ---------------------------------------------------------------------------
function mk(db: Db): FastifyInstance {
  const app = Fastify();
  registerRoutes(app, {
    db,
    cfg: { reconLiveWallet: '0xreal', explorerBase: 'https://x', exceptionLowConfidence: 0.85 } as never,
    classifyClient: {} as never,
    copilotClient: {} as never,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    memory: new OffMemory(),
  });
  return app;
}

const ENT = "INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')";

// ---------------------------------------------------------------------------
// Route monkey tests
// ---------------------------------------------------------------------------
describe('recon monkey — routes', () => {
  let db: Db; let app: FastifyInstance;

  beforeEach(async () => {
    db = openDb(':memory:');
    db.prepare(ENT).run();
    app = mk(db);
    await app.ready();
  });

  it('breakId with zero pipes → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/recon-breaks/nopipe/disposition',
      payload: { state: 'resolved', reasonCode: 'error' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('coinType containing :: round-trips through single-pipe parse', async () => {
    // acme:pilot-001 fixture has 0xusdc::usdc::USDC with a material break
    // (openingMinor=5000000000, statementMinor=5000500000, threshold=100000 → break=500000 ≥ threshold).
    // Entity is seeded in beforeEach so collectBreaks finds the fixture row → 200.
    const res = await app.inject({
      method: 'POST',
      url: `/recon-breaks/${encodeURIComponent('0xacmeTreasury|0xusdc::usdc::USDC')}/disposition`,
      payload: { state: 'dismissed', reasonCode: 'unidentified' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().disposition.coinType).toBe('0xusdc::usdc::USDC');
  });

  it('unknown reasonCode → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/recon-breaks/${encodeURIComponent('0xacmeTreasury|0x2::sui::SUI')}/disposition`,
      payload: { state: 'resolved', reasonCode: 'NOPE' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Disposition service monkey tests (pure DB, no HTTP)
// ---------------------------------------------------------------------------
describe('recon monkey — disposition service', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    db.prepare(ENT).run();
  });

  it('serial re-disposition: last write wins, log keeps both, no corruption', () => {
    const args = {
      entityId: 'acme:pilot-001',
      periodId: '2026-Q2',
      wallet: '0xw',
      coinType: '0x2::sui::SUI',
      decidedBy: 'demo-controller',
    };
    applyReconDisposition(db, { ...args, to: 'deferred', reasonCode: 'timing', now: 1 });
    applyReconDisposition(db, { ...args, to: 'resolved', reasonCode: 'error', now: 2 });

    const log = db.prepare('SELECT count(*) c FROM recon_break_disposition_log').get() as { c: number };
    expect(log.c).toBe(2);

    const main = db.prepare('SELECT count(*) c FROM recon_break_disposition').get() as { c: number };
    expect(main.c).toBe(1);
  });

  it('in-transit is a valid resolution code (tracked reconciling item, not dismiss)', () => {
    const row = applyReconDisposition(db, {
      entityId: 'acme:pilot-001',
      periodId: '2026-Q2',
      wallet: '0xacmeTreasury',
      coinType: '0xweth::weth::WETH',
      to: 'resolved',
      reasonCode: 'in-transit',
      decidedBy: 'demo-controller',
      now: 1,
    });
    expect(row.reasonCode).toBe('in-transit');
    expect(row.state).toBe('resolved');
  });
});

// ---------------------------------------------------------------------------
// Fixture validation negative-path tests
//
// Uses the REAL exported validateReconRows from fixture.ts so that a
// regression in the production guards will fail these tests (no drift).
// ---------------------------------------------------------------------------

describe('recon monkey — fixture validation guards', () => {
  it('throws on negative openingMinor (asset-positive convention)', () => {
    expect(() => validateReconRows([
      { wallet: '0xw', coinType: '0x2::sui::SUI', decimals: 9, openingMinor: '-1', statementMinor: '0', thresholdMinor: '0' },
    ], 'test-entity')).toThrow(/must be >= 0/i);
  });

  it('throws on non-numeric string minor', () => {
    expect(() => validateReconRows([
      { wallet: '0xw', coinType: '0x2::sui::SUI', decimals: 9, openingMinor: 'abc', statementMinor: '0', thresholdMinor: '0' },
    ], 'test-entity')).toThrow(/not a valid integer minor/i);
  });

  it('throws on duplicate (wallet, coinType) row', () => {
    const row = { wallet: '0xw', coinType: '0x2::sui::SUI', decimals: 9, openingMinor: '0', statementMinor: '0', thresholdMinor: '0' };
    expect(() => validateReconRows([row, row], 'test-entity')).toThrow(/duplicate row/i);
  });

  it('throws on unknown entity — real loadReconFixture (fail-loud, no silent empty)', async () => {
    const { loadReconFixture } = await import('../src/reconciliation/fixture.js');
    expect(() => loadReconFixture('no:such')).toThrow(/no recon fixture/i);
  });
});
