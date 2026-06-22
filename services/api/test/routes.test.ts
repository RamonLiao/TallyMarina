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
