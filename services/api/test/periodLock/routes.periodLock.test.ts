/**
 * Integration tests for Period Close Cockpit endpoints:
 *   GET  /entities/:id/close-cockpit
 *   POST /entities/:id/period/lock
 *   POST /entities/:id/period/reopen
 * And the modified POST /entities/:id/snapshot (LOCKED-gate).
 *
 * WHY each test matters is noted inline — these encode control intent, not just HTTP codes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/store/db.js';
import { seed } from '../../src/store/seed.js';
import { registerRoutes } from '../../src/http/routes.js';
import type { GeminiClient } from '../../src/ai/geminiClient.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fixture = require('../../src/fixtures/acme-pilot-001.events.json') as unknown;
import { loadConfig } from '../../src/config.js';
import type { FixtureBundle } from '../../src/deps/ingestion.js';
import { upsertReconDisposition } from '../../src/store/reconBreakStore.js';

const RECON_BREAKS = [
  '0xacmeTreasury|0x2::sui::SUI',
  '0xacmeTreasury|0xusdc::usdc::USDC',
  '0xacmeTreasury|0xweth::weth::WETH',
  '0xacmeTreasury|0xusdt::usdt::USDT',
];
function dismissReconBreaks(database: Db, entityId: string, periodId: string) {
  for (const key of RECON_BREAKS) {
    const [wallet, coinType] = key.split('|') as [string, string];
    upsertReconDisposition(database, {
      entityId, periodId, wallet, coinType,
      state: 'dismissed', reasonCode: 'unidentified', reasonNote: null,
      decidedBy: 'test', decidedAt: Date.now(),
    });
  }
}

const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'https://grpc', ANCHOR_PACKAGE_ID: '0xpkg',
  ANCHOR_ORIGINAL_PACKAGE_ID: '0xpkg', ENTITY_ID: 'acme:pilot-001',
  ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm1', AI_MODEL_COPILOT: 'm2',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});

// Truthful high-confidence stub: echoes the event's real eventType from the prompt
// (the F3 deterministic AUTO gate requires LLM agreement with the normalized type).
const classifyClient: GeminiClient = {
  async generateJson(_model: string, prompt: string) {
    const m = /"eventType"\s*:\s*"([A-Z_]+)"/.exec(prompt);
    if (!m) throw new Error('classify stub: eventType not found in prompt — prompt format changed?');
    return { eventType: m?.[1] ?? 'DIGITAL_ASSET_RECEIPT', economicPurpose: 'X', counterparty: null, confidence: 0.92, reasoning: 'r' } as never;
  },
};

let app: FastifyInstance;
let db: Db;

/** Run the full "all-green" recipe: classify both events → run-rules → dismiss recon breaks. */
async function makeAllGreen() {
  await app.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
  await app.inject({ method: 'POST', url: '/events/evt-002/classify', payload: {} });
  await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/run-rules', payload: { periodId: '2026-Q2' } });
  dismissReconBreaks(db, 'acme:pilot-001', '2026-Q2');
}

beforeEach(async () => {
  db = openDb(':memory:');
  seed(db, {
    entityId: cfg.entityId,
    entityChainId: cfg.entityChainId,
    entityCapId: cfg.entityCapId,
    originalPackageId: cfg.anchorOriginalPackageId,
  }, fixture as FixtureBundle);
  app = Fastify();
  registerRoutes(app, {
    db, cfg, classifyClient, copilotClient: classifyClient,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
  });
  await app.ready();
});

describe('Period Close Cockpit — integration', () => {
  // Test 1
  it('GET /close-cockpit returns 6 lights and status OPEN for a fresh entity', async () => {
    // WHY: the cockpit is the single source of truth for close-readiness. A fresh entity
    // must show OPEN with all 6 light keys present so the UI can render complete status.
    const r = await app.inject({ method: 'GET', url: '/entities/acme:pilot-001/close-cockpit' });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { lights: Array<{ key: string; status: string }>; status: string };
    expect(body.status).toBe('OPEN');
    expect(body.lights).toHaveLength(6);
    const keys = body.lights.map((l) => l.key);
    expect(keys).toContain('classification');
    expect(keys).toContain('je');
    expect(keys).toContain('recon');
    expect(keys).toContain('completeness');
    expect(keys).toContain('pricing');
    expect(keys).toContain('export');
  });

  // Test 2
  it('POST /period/lock with a red blocking light → 409 LIGHTS_NOT_GREEN', async () => {
    // WHY: locking while lights are red would close a period with unresolved errors —
    // the server must recompute and reject, never trust client-sent lights.
    const r = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: {} });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('LIGHTS_NOT_GREEN');
  });

  // Test 3
  it('all-green → lock 200 LOCKED, cockpit reflects LOCKED', async () => {
    // WHY: lock must recompute server-side and transition state; the subsequent
    // cockpit read must reflect the new LOCKED status, proving state persistence.
    await makeAllGreen();
    const lockR = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: {} });
    expect(lockR.statusCode).toBe(200);
    const lockBody = lockR.json() as { lock: { status: string } };
    expect(lockBody.lock.status).toBe('LOCKED');

    const cockpitR = await app.inject({ method: 'GET', url: '/entities/acme:pilot-001/close-cockpit' });
    const cockpitBody = cockpitR.json() as { status: string };
    expect(cockpitBody.status).toBe('LOCKED');
  });

  // Test 4
  it('POST /snapshot while period is OPEN → 409 PERIOD_NOT_LOCKED', async () => {
    // WHY: snapshot is the immutable audit artifact; creating it without a lock
    // means no review gate was passed. The lock must be the hard prerequisite.
    await makeAllGreen();
    // Do NOT lock — snapshot should be blocked.
    const snapR = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/snapshot',
      payload: { periodId: '2026-Q2' },
    });
    expect(snapR.statusCode).toBe(409);
    expect((snapR.json() as { error: { code: string } }).error.code).toBe('PERIOD_NOT_LOCKED');
  });

  // Test 5
  it('double-lock (lock → lock) → 409 ILLEGAL_TRANSITION', async () => {
    // WHY: LOCKED→lock is not a legal transition; allowing it would corrupt the
    // audit trail by overwriting the lights snapshot and lockedAt timestamp.
    await makeAllGreen();
    await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: {} });
    const r = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: {} });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('ILLEGAL_TRANSITION');
  });

  // Test 6
  it('POST /period/reopen with empty restatementReason → 400 VALIDATION', async () => {
    // WHY: every reopen must record a material explanation for the audit trail.
    // Accepting empty reasons would undermine ASC 250 / IAS 8 disclosure requirements.
    await makeAllGreen();
    await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: {} });
    const r = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/period/reopen',
      payload: { restatementReason: '', reasonCode: 'ERROR_CORRECTION' },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  // Test 7
  it('POST /period/reopen with unknown reasonCode → 400 VALIDATION', async () => {
    // WHY: unknown reason codes cannot be mapped to disclosure treatment;
    // accepting them silently would produce unclassified restatements.
    await makeAllGreen();
    await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: {} });
    const r = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/period/reopen',
      payload: { restatementReason: 'Fix something', reasonCode: 'TOTALLY_UNKNOWN' },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  // Test 8
  it('lock → reopen valid → 200 OPEN, reopenCount 1', async () => {
    // WHY: a valid reopen must decrement the status back to OPEN and increment
    // reopenCount, so the audit trail shows exactly how many times the period was unwound.
    await makeAllGreen();
    await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: {} });
    const r = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/period/reopen',
      payload: { restatementReason: 'Found a late-arriving txn', reasonCode: 'LATE_ARRIVING_TXN' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { lock: { status: string; reopenCount: number } };
    expect(body.lock.status).toBe('OPEN');
    expect(body.lock.reopenCount).toBe(1);
  });
});
