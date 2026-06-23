import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { seed } from '../src/store/seed.js';
import { registerRoutes } from '../src/http/routes.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fixture = require('../src/fixtures/acme-pilot-001.events.json') as unknown;
import { loadConfig } from '../src/config.js';
import type { FixtureBundle } from '../src/deps/ingestion.js';
import { insertSnapshot } from '../src/store/snapshotStore.js';
import { insertEntity } from '../src/store/entityStore.js';
import { deriveEntityRef } from '../src/deps/anchorSvc.js';
import { upsertReconDisposition } from '../src/store/reconBreakStore.js';

// Fixture recon breaks that need dismissal before any snapshot can proceed.
const RECON_BREAKS = [
  '0xacmeTreasury|0x2::sui::SUI',
  '0xacmeTreasury|0xusdc::usdc::USDC',
  '0xacmeTreasury|0xweth::weth::WETH',
  '0xacmeTreasury|0xusdt::usdt::USDT',
];
function dismissReconBreaks(database: Db, entityId: string, periodId: string) {
  for (const key of RECON_BREAKS) {
    const [wallet, coinType] = key.split('|');
    upsertReconDisposition(database, { entityId, periodId, wallet, coinType, state: 'dismissed', reasonCode: 'IMMATERIAL_WAIVED', reasonNote: null, decidedBy: 'test', decidedAt: Date.now() });
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

const classifyClient: GeminiClient = {
  async generateJson() {
    return { eventType: 'DIGITAL_ASSET_RECEIPT', economicPurpose: 'X', counterparty: null, confidence: 0.92, reasoning: 'r' } as never;
  },
};

let app: FastifyInstance;
let db: Db;

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

describe('REST contract', () => {
  it('GET /entities returns the seeded entity in EntityDTO shape', async () => {
    const r = await app.inject({ method: 'GET', url: '/entities' });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { entities: Array<{ id: string; capObjectId: string }> };
    expect(body.entities[0]?.id).toBe('acme:pilot-001');
    expect(body.entities[0]).toHaveProperty('capObjectId');
  });

  it('GET /entities/:id/events lists ingested events with status INGESTED', async () => {
    const r = await app.inject({ method: 'GET', url: '/entities/acme:pilot-001/events' });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { events: Array<{ status: string; normalized: unknown }> };
    expect(body.events.length).toBeGreaterThanOrEqual(2);
    expect(body.events[0]?.status).toBe('INGESTED');
    expect(body.events[0]).toHaveProperty('normalized');
  });

  it('POST /events/:id/classify routes AUTO at confidence 0.92', async () => {
    const r = await app.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { event: { status: string; ai: { confidence: number } }; degraded: boolean };
    expect(body.event.status).toBe('AUTO');
    expect(body.degraded).toBe(false);
    expect(body.event.ai.confidence).toBeCloseTo(0.92);
  });

  it('classify degrades gracefully on AI error (degraded=true, no throw)', async () => {
    const errClient: GeminiClient = {
      async generateJson() { throw new Error('upstream down'); },
    };
    const app2 = Fastify();
    registerRoutes(app2, {
      db, cfg, classifyClient: errClient, copilotClient: errClient,
      anchorAdapter: null as never,
      mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    });
    await app2.ready();
    const r = await app2.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { event: { status: string }; degraded: boolean };
    expect(body.degraded).toBe(true);
    expect(body.event.status).toBe('NEEDS_REVIEW');
  });

  it('decide on a non-review event fails closed with 409 ILLEGAL_TRANSITION', async () => {
    const r = await app.inject({
      method: 'POST', url: '/reviews/evt-001/decide',
      payload: { finalEventType: 'X', finalPurpose: 'Y' },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('unknown entity → 404 ENTITY_NOT_FOUND envelope', async () => {
    const r = await app.inject({ method: 'GET', url: '/entities/nope/events' });
    expect(r.statusCode).toBe(404);
    expect((r.json() as { error: { code: string } }).error.code).toBe('ENTITY_NOT_FOUND');
  });

  it('unknown event → 404 EVENT_NOT_FOUND envelope', async () => {
    const r = await app.inject({ method: 'POST', url: '/events/no-such-event/classify', payload: {} });
    expect(r.statusCode).toBe(404);
    expect((r.json() as { error: { code: string } }).error.code).toBe('EVENT_NOT_FOUND');
  });

  it('error envelope shape has exactly {error:{code,message}}', async () => {
    const r = await app.inject({ method: 'GET', url: '/entities/nope/events' });
    const body = r.json() as { error: unknown };
    expect(Object.keys(body)).toEqual(['error']);
    const e = body.error as Record<string, unknown>;
    expect(typeof e['code']).toBe('string');
    expect(typeof e['message']).toBe('string');
  });

  it('GET /entities/:id/review-queue returns 404 for unknown entity', async () => {
    const r = await app.inject({ method: 'GET', url: '/entities/nope/review-queue' });
    expect(r.statusCode).toBe(404);
  });

  it('full main line: classify both → run-rules posts JEs → snapshot FROZEN', async () => {
    await app.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    await app.inject({ method: 'POST', url: '/events/evt-002/classify', payload: {} });
    const rr = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/run-rules',
      payload: { periodId: '2026-Q2' },
    });
    expect(rr.statusCode).toBe(200);
    const rrBody = rr.json() as { posted: number; skipped: number; journal: unknown[] };
    expect(rrBody.posted).toBeGreaterThanOrEqual(1);
    dismissReconBreaks(db, 'acme:pilot-001', '2026-Q2');
    const snap = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/snapshot',
      payload: { periodId: '2026-Q2' },
    });
    expect(snap.statusCode).toBe(200);
    const snapBody = snap.json() as { snapshot: { status: string; manifestHash: string; merkleRoot: string } };
    expect(snapBody.snapshot.status).toBe('FROZEN');
    expect(snapBody.snapshot.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapBody.snapshot.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  it('re-freezing the same period is idempotent (no PK-collision 500)', async () => {
    // WHY: snapshot id is content-deterministic, and the UI re-POSTs on page
    // refresh / repeated clicks. A naive INSERT throws SQLITE UNIQUE → 500 and
    // blocks the whole anchor flow. Re-freeze must return the existing FROZEN row.
    await app.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    await app.inject({ method: 'POST', url: '/events/evt-002/classify', payload: {} });
    await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/run-rules', payload: { periodId: '2026-Q2' },
    });
    dismissReconBreaks(db, 'acme:pilot-001', '2026-Q2');
    const first = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/snapshot', payload: { periodId: '2026-Q2' },
    });
    const second = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/snapshot', payload: { periodId: '2026-Q2' },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const a = first.json() as { snapshot: { id: string; merkleRoot: string; status: string } };
    const b = second.json() as { snapshot: { id: string; merkleRoot: string; status: string } };
    expect(b.snapshot.id).toBe(a.snapshot.id);
    expect(b.snapshot.merkleRoot).toBe(a.snapshot.merkleRoot); // content-identical
    expect(b.snapshot.status).toBe('FROZEN');
  });

  it('re-freeze fails closed (409) if the resolved id belongs to a different period', async () => {
    // WHY: the snapshot id joins entityId + periodId with `-`, which is ambiguous
    // (acme:pilot + 001-2026-Q2 collides with acme:pilot-001 + 2026-Q2). The idempotent
    // path must verify entityId + periodId on the resolved row before returning, or it
    // leaks another entity/period's snapshot metadata. Simulate the collision by
    // repointing the row's period_id (period_id has no FK, unlike entity_id).
    await app.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    await app.inject({ method: 'POST', url: '/events/evt-002/classify', payload: {} });
    await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/run-rules', payload: { periodId: '2026-Q2' } });
    dismissReconBreaks(db, 'acme:pilot-001', '2026-Q2');
    const first = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/snapshot', payload: { periodId: '2026-Q2' } });
    const { snapshot } = first.json() as { snapshot: { id: string } };
    // period_id has no FK; repointing it simulates an id that resolves to a different period.
    db.prepare('UPDATE snapshots SET period_id=? WHERE id=?').run('1999-Q1', snapshot.id);
    const second = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/snapshot', payload: { periodId: '2026-Q2' } });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('SNAPSHOT_CONFLICT');
  });

  it('re-freeze of an already-ANCHORED period fails loud (409 ALREADY_ANCHORED)', async () => {
    // WHY: once anchored the snapshot is immutable. Returning it as a freezable FROZEN
    // row would let the UI offer Anchor again, and prepare would then 409 cryptically.
    await app.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    await app.inject({ method: 'POST', url: '/events/evt-002/classify', payload: {} });
    await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/run-rules', payload: { periodId: '2026-Q2' } });
    dismissReconBreaks(db, 'acme:pilot-001', '2026-Q2');
    const first = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/snapshot', payload: { periodId: '2026-Q2' } });
    const { snapshot } = first.json() as { snapshot: { id: string } };
    db.prepare("UPDATE snapshots SET status='ANCHORED' WHERE id=?").run(snapshot.id);
    const second = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/snapshot', payload: { periodId: '2026-Q2' } });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('ALREADY_ANCHORED');
  });

  it('GET /entities/:id/journal returns JournalDTO shape', async () => {
    // Run through classify → run-rules first
    await app.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/run-rules',
      payload: { periodId: '2026-Q2' },
    });
    const r = await app.inject({ method: 'GET', url: '/entities/acme:pilot-001/journal' });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { journal: Array<Record<string, unknown>> };
    if (body.journal.length > 0) {
      const je = body.journal[0]!;
      expect(je).toHaveProperty('id');
      expect(je).toHaveProperty('eventId');
      expect(je).toHaveProperty('idempotencyKey');
      expect(je).toHaveProperty('leafHash');
      expect(je).toHaveProperty('je');
    }
  });

  it('POST /entities/:id/run-rules returns 400 if periodId missing', async () => {
    const r = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/run-rules', payload: {} });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('POST /entities/:id/snapshot returns 400 if periodId missing', async () => {
    const r = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/snapshot', payload: {} });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('POST /entities/:id/anchor/prepare returns 400 if params missing', async () => {
    const r = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/anchor/prepare', payload: {} });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('POST /entities/:id/anchor/confirm returns 400 if params missing', async () => {
    const r = await app.inject({ method: 'POST', url: '/entities/acme:pilot-001/anchor/confirm', payload: {} });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('GET /entities/:id/anchors returns empty anchors list', async () => {
    const r = await app.inject({ method: 'GET', url: '/entities/acme:pilot-001/anchors' });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { anchors: unknown[]; inclusionProof: null };
    expect(Array.isArray(body.anchors)).toBe(true);
    expect(body.inclusionProof).toBeNull();
  });

  // I3: null adapter → 502 CHAIN_UNREACHABLE (fail-closed, no null-deref TypeError)
  it('I3: anchor/prepare with null adapter → 502 CHAIN_UNREACHABLE envelope', async () => {
    const r = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/anchor/prepare',
      payload: { snapshotId: 'snap-x', walletAddress: '0x' + '11'.repeat(32) },
    });
    expect(r.statusCode).toBe(502);
    expect((r.json() as { error: { code: string } }).error.code).toBe('CHAIN_UNREACHABLE');
  });

  it('I3: anchor/confirm with null adapter → 502 CHAIN_UNREACHABLE envelope', async () => {
    const r = await app.inject({
      method: 'POST', url: '/entities/acme:pilot-001/anchor/confirm',
      payload: { snapshotId: 'snap-x', digest: 'D', expectedSeq: 1 },
    });
    expect(r.statusCode).toBe(502);
    expect((r.json() as { error: { code: string } }).error.code).toBe('CHAIN_UNREACHABLE');
  });

  it('POST /reviews/:eventId/decide approves a NEEDS_REVIEW event', async () => {
    // First classify to NEEDS_REVIEW using low-confidence client
    const lowClient: GeminiClient = {
      async generateJson() {
        return { eventType: 'DIGITAL_ASSET_RECEIPT', economicPurpose: 'X', counterparty: null, confidence: 0.5, reasoning: 'r' } as never;
      },
    };
    const app3 = Fastify();
    registerRoutes(app3, {
      db, cfg, classifyClient: lowClient, copilotClient: lowClient,
      anchorAdapter: null as never,
      mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    });
    await app3.ready();
    await app3.inject({ method: 'POST', url: '/events/evt-001/classify', payload: {} });
    const r = await app3.inject({
      method: 'POST', url: '/reviews/evt-001/decide',
      payload: { finalEventType: 'DIGITAL_ASSET_RECEIPT', finalPurpose: 'RECEIVABLE_SETTLEMENT' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { event: { status: string } };
    expect(body.event.status).toBe('APPROVED');
  });
});

// ---- Anchor route tests with working fakeAdapter (I1, I2) ----
const PKG_ID = '0x' + 'af'.repeat(32);
const CHAIN_OBJ = '0x' + '12'.repeat(32);
const CAP_OBJ = '0x' + '34'.repeat(32);
const WALLET_ADDR = '0x' + '56'.repeat(32);
const VALID_HASH = 'ab'.repeat(32);
const VALID_ROOT = 'cd'.repeat(32);
const ANCHOR_ENTITY = 'anchor-test-entity';

const cfgAnchor = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'g',
  ANCHOR_PACKAGE_ID: PKG_ID,
  ANCHOR_ORIGINAL_PACKAGE_ID: '0x' + '78'.repeat(32),
  ENTITY_ID: ANCHOR_ENTITY, ENTITY_CHAIN_ID: CHAIN_OBJ, ENTITY_CAP_ID: CAP_OBJ,
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm', AI_MODEL_COPILOT: 'm',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});

function buildFakeAdapter(over: Partial<{ seq: bigint; seqMismatch: boolean }> = {}) {
  const seq = over.seq ?? 0n;
  const headSeq = over.seqMismatch ? seq + 99n : seq + 1n;
  return {
    async getChainState() {
      return { entityRef: deriveEntityRef(ANCHOR_ENTITY), latestLink: new Uint8Array(32), seq, capEpoch: 0n };
    },
    async getCapOwner() { return WALLET_ADDR; },
    async waitForTransaction() { return; },
    async getAnchorEvent() { return { seq: headSeq, link: new Uint8Array([7]) }; },
  } as never;
}

describe('anchor routes (I1, I2) — with working fakeAdapter', () => {
  let anchorDb: Db;
  let anchorApp: FastifyInstance;

  beforeEach(async () => {
    anchorDb = openDb(':memory:');
    insertEntity(anchorDb, {
      id: ANCHOR_ENTITY, displayName: 'Anchor Test', chainObjectId: CHAIN_OBJ,
      capObjectId: CAP_OBJ, originalPackageId: '0x' + '78'.repeat(32),
    });
    insertSnapshot(anchorDb, {
      id: 'snap-anchor-1', entityId: ANCHOR_ENTITY, periodId: '2026-Q2',
      manifestJson: '{}', manifestHash: VALID_HASH, merkleRoot: VALID_ROOT,
      leafCount: 1, supersedesSeq: 0,
    });
    anchorApp = Fastify();
    registerRoutes(anchorApp, {
      db: anchorDb, cfg: cfgAnchor, classifyClient: classifyClient, copilotClient: classifyClient,
      anchorAdapter: buildFakeAdapter(),
      mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    });
    await anchorApp.ready();
  });

  // I1: CLIENT_HASH_REJECTED — route rejects client-supplied hash fields
  it('I1: prepare with manifestHash in body → 400 CLIENT_HASH_REJECTED', async () => {
    const r = await anchorApp.inject({
      method: 'POST', url: `/entities/${ANCHOR_ENTITY}/anchor/prepare`,
      payload: { snapshotId: 'snap-anchor-1', walletAddress: WALLET_ADDR, manifestHash: 'deadbeef'.repeat(8) },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('CLIENT_HASH_REJECTED');
  });

  it('I1: prepare with merkleRoot in body → 400 CLIENT_HASH_REJECTED', async () => {
    const r = await anchorApp.inject({
      method: 'POST', url: `/entities/${ANCHOR_ENTITY}/anchor/prepare`,
      payload: { snapshotId: 'snap-anchor-1', walletAddress: WALLET_ADDR, merkleRoot: 'cafebabe'.repeat(8) },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe('CLIENT_HASH_REJECTED');
  });

  // I2: prepare returns expected shape
  it('I2: prepare returns {txKind, expectedSeq, chainId, capId}', async () => {
    const r = await anchorApp.inject({
      method: 'POST', url: `/entities/${ANCHOR_ENTITY}/anchor/prepare`,
      payload: { snapshotId: 'snap-anchor-1', walletAddress: WALLET_ADDR },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { txKind: string; expectedSeq: number; chainId: string; capId: string };
    expect(typeof body.txKind).toBe('string');
    expect(body.expectedSeq).toBe(1);
    expect(body.chainId).toBe(CHAIN_OBJ);
    expect(body.capId).toBe(CAP_OBJ);
  });

  // I2: confirm with matching seq returns AnchorDTO — adapter must return seq=1 (matching expectedSeq=1)
  it('I2: confirm with matching seq returns {anchor: AnchorDTO}', async () => {
    const confirmApp = Fastify();
    registerRoutes(confirmApp, {
      db: anchorDb, cfg: cfgAnchor, classifyClient: classifyClient, copilotClient: classifyClient,
      anchorAdapter: buildFakeAdapter({ seq: 1n }), // getChainState returns seq=1, expectedSeq=1
      mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    });
    await confirmApp.ready();
    const r = await confirmApp.inject({
      method: 'POST', url: `/entities/${ANCHOR_ENTITY}/anchor/confirm`,
      payload: { snapshotId: 'snap-anchor-1', digest: 'DIGEST-OK', expectedSeq: 1 },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { anchor: { digest: string; explorerUrl: string; seq: number } };
    expect(body.anchor.digest).toBe('DIGEST-OK');
    expect(body.anchor.explorerUrl).toContain('/tx/DIGEST-OK');
    expect(typeof body.anchor.seq).toBe('number');
  });

  // I2: confirm with seq mismatch → 409 SEQ_MISMATCH; snapshot stays FROZEN
  it('I2: confirm with seq mismatch → 409 SEQ_MISMATCH; snapshot stays FROZEN', async () => {
    const mismatchApp = Fastify();
    registerRoutes(mismatchApp, {
      db: anchorDb, cfg: cfgAnchor, classifyClient: classifyClient, copilotClient: classifyClient,
      anchorAdapter: buildFakeAdapter({ seqMismatch: true }),
      mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    });
    await mismatchApp.ready();
    const r = await mismatchApp.inject({
      method: 'POST', url: `/entities/${ANCHOR_ENTITY}/anchor/confirm`,
      payload: { snapshotId: 'snap-anchor-1', digest: 'DIGEST-MISMATCH', expectedSeq: 1 },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe('SEQ_MISMATCH');
    // Snapshot must still be FROZEN
    const { getSnapshot: getSnap } = await import('../src/store/snapshotStore.js');
    const snap = getSnap(anchorDb, 'snap-anchor-1');
    expect(snap?.status).toBe('FROZEN');
  });

  // M2: 500 handler sends generic message, not err.message
  it('M2: 500 error envelope has generic "Internal error" message (not raw err.message)', async () => {
    // Cause an unhandled error by making the mutex throw a plain Error (not ApiError/AnchorError/StateError/SnapshotError)
    const throwingApp = Fastify();
    registerRoutes(throwingApp, {
      db: anchorDb, cfg: cfgAnchor, classifyClient: classifyClient, copilotClient: classifyClient,
      anchorAdapter: buildFakeAdapter(),
      mutex: {
        run: (_k: string, _fn: () => Promise<never>) => {
          throw new Error('SECRET internal message do not expose');
        },
      },
    });
    await throwingApp.ready();
    const r = await throwingApp.inject({
      method: 'POST', url: `/entities/${ANCHOR_ENTITY}/anchor/prepare`,
      payload: { snapshotId: 'snap-anchor-1', walletAddress: WALLET_ADDR },
    });
    expect(r.statusCode).toBe(500);
    const body = r.json() as { error: { message: string; code: string } };
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('Internal error');
    expect(body.error.message).not.toContain('SECRET');
  });
});
