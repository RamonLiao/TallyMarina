/**
 * Monkey / adversarial tests for Period Close Cockpit endpoints.
 * These tests deliberately try to break the system via edge cases, bad inputs,
 * and concurrent operations. Each WHY-comment encodes the control intent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/store/db.js';
import { registerAcmeFixtureAssets } from '../helpers/registerTestAsset.js';
import { seed } from '../../src/store/seed.js';
import { registerRoutes } from '../../src/http/routes.js';
import { OffMemory } from '../../src/triage/memory/offMemory.js';
import type { GeminiClient } from '../../src/ai/geminiClient.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fixture = require('../../src/fixtures/acme-pilot-001.events.json') as unknown;
import { loadConfig } from '../../src/config.js';
import type { FixtureBundle } from '../../src/deps/ingestion.js';
import { upsertReconDisposition } from '../../src/store/reconBreakStore.js';
import { getPeriodLock } from '../../src/periodLock/store.js';
import { makeRevaluationGreen } from '../helpers/revaluation.js';

const RECON_BREAKS = [
  '0xacmeTreasury|0x2::sui::SUI',
  '0xacmeTreasury|0xbeef::usdc::USDC',
  '0xacmeTreasury|0xcafe::weth::WETH',
  '0xacmeTreasury|0xdead::usdt::USDT',
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

async function makeAllGreen() {
  // Ingest ALL events (classifies the two txns, bypasses OPENING_LOT → APPROVED) so nothing is
  // left stuck at INGESTED to red the completeness light.
  await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/ingest', payload: {} });
  await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/run-rules', payload: { periodId: '2026-Q2' } });
  dismissReconBreaks(db, 'acme:pilot-001', '2026-Q2');
  await makeRevaluationGreen(app, 'acme:pilot-001', '2026-Q2'); // Task 7: revaluation light precondition
}

beforeEach(async () => {
  db = openDb(':memory:');
  seed(db, {
    entityId: cfg.entityId,
    entityChainId: cfg.entityChainId,
    entityCapId: cfg.entityCapId,
    originalPackageId: cfg.anchorOriginalPackageId,
  }, fixture as FixtureBundle);
  registerAcmeFixtureAssets(db, cfg.entityId); // registry close-gate precondition (assets have known scale)
  app = Fastify();
  registerRoutes(app, {
    db, cfg, classifyClient, copilotClient: classifyClient,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    memory: new OffMemory(),
  });
  await app.ready();
});

describe('Monkey tests — Period Close Cockpit', () => {
  // M1
  it('M1: reopen on a never-locked period → 409 ILLEGAL_TRANSITION', async () => {
    // WHY: OPEN→reopen is not a legal transition. Allowing it would create a
    // reopenCount > 0 record on a period that was never closed, corrupting the audit trail.
    const r = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/period/reopen',
      payload: { restatementReason: 'Trying to reopen without lock', reasonCode: 'ERROR_CORRECTION' },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('ILLEGAL_TRANSITION');
  });

  // M2
  it('M2: restatementReason of 600 chars → 400 VALIDATION (>512 limit)', async () => {
    // WHY: unbounded reason strings bloat the audit DB and can trigger downstream
    // truncation, silently destroying the recorded rationale. 512 is the hard cap.
    await makeAllGreen();
    await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: { periodId: '2026-Q2' } });
    const longReason = 'X'.repeat(600);
    const r = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/period/reopen',
      payload: { restatementReason: longReason, reasonCode: 'ERROR_CORRECTION' },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  // M3
  it('M3: concurrent lock + reopen Promise.all → exactly one mutates, final state is consistent', async () => {
    // WHY: better-sqlite3 is synchronous so transactions serialize in the SQLite layer,
    // but the HTTP layer could still submit both requests. The CAS in the store must
    // ensure exactly one wins and the other 409s — the period_lock row must not be corrupted.
    await makeAllGreen();
    // First lock so reopen has something to race against.
    const lockFirst = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: { periodId: '2026-Q2' } });
    expect(lockFirst.statusCode).toBe(200);

    // Now race: another lock attempt vs a reopen (only one can win).
    const [lockAgain, reopen] = await Promise.all([
      app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: { periodId: '2026-Q2' } }),
      app.inject({
        method: 'POST', url: '/entities/acme:pilot-001/period/reopen',
        payload: { restatementReason: 'Concurrent reopen attempt', reasonCode: 'ERROR_CORRECTION' },
      }),
    ]);

    // Exactly one should succeed (200), the other must fail (409).
    const statuses = [lockAgain.statusCode, reopen.statusCode].sort();
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);

    // Final state must be consistent (not corrupted).
    // The CAS must ensure exactly one of two valid pairs: either the reopen won
    // and the period is OPEN with reopenCount=1, or the lock won and the period
    // is LOCKED with reopenCount=0. Any other (status, reopenCount) pair is corruption.
    const finalLock = getPeriodLock(db, 'acme:pilot-001', '2026-Q2');
    const validPairs = [
      { status: 'LOCKED', reopenCount: 0 },  // Second lock won, reopen was rejected.
      { status: 'OPEN', reopenCount: 1 },    // Reopen won, second lock was rejected.
    ];
    const matches = validPairs.some(
      pair => finalLock.status === pair.status && finalLock.reopenCount === pair.reopenCount
    );
    expect(matches).toBe(true);
  });

  // M4
  it('M4: POST /period/lock with forged client lights body while recon is red → 409 LIGHTS_NOT_GREEN', async () => {
    // WHY: the lock endpoint must recompute lights server-side. A client sending
    // { lights: { recon: 'green' } } in the body must not be able to bypass the gate.
    const r = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/period/lock',
      payload: { periodId: '2026-Q2', lights: { recon: 'green', classification: 'green', je: 'green', completeness: 'green' } },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('LIGHTS_NOT_GREEN');
  });

  // M5
  it('M5: re-freeze (POST /snapshot) after reopen WITHOUT re-lock → 409 PERIOD_NOT_LOCKED', async () => {
    // WHY: after a reopen the period is OPEN again. The review/lock cycle must be
    // repeated before a new snapshot can be created — there is no shortcut path.
    await makeAllGreen();
    await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/period/lock', payload: { periodId: '2026-Q2' } });
    // Reopen the period.
    await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/period/reopen',
      payload: { restatementReason: 'Late txn arrived', reasonCode: 'LATE_ARRIVING_TXN' },
    });
    // Attempt snapshot WITHOUT re-locking — must be blocked.
    const snapR = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/snapshot',
      payload: { periodId: '2026-Q2' },
    });
    expect(snapR.statusCode).toBe(409);
    expect((snapR.json() as { error: { code: string } }).error.code).toBe('PERIOD_NOT_LOCKED');
  });
});
