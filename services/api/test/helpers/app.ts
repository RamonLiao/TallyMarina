/**
 * Shared Fastify test-app factory for route tests.
 * Mirrors the setup in routes.test.ts exactly; seeds entity "e1" using the real fixture.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { createRequire } from 'node:module';
import { openDb, type Db } from '../../src/store/db.js';
import { registerRoutes } from '../../src/http/routes.js';
import type { GeminiClient } from '../../src/ai/geminiClient.js';
import { loadConfig } from '../../src/config.js';
import { seed } from '../../src/store/seed.js';
import type { FixtureBundle } from '../../src/deps/ingestion.js';
import type { MemoryClient } from '../../src/triage/memory/types.js';
import { OffMemory } from '../../src/triage/memory/offMemory.js';
import { insertPricePoint } from '../../src/store/pricePointStore.js';

const require = createRequire(import.meta.url);
const fixture = require('../../src/fixtures/acme-pilot-001.events.json') as unknown;

// Entity ID matches the fixture's rawJson so run-rules can produce JEs (rules engine
// checks event.entityId === runContext.entityId; fixture rawJson has 'acme:pilot-001').
export const TEST_ENTITY_ID = 'acme:pilot-001';

export const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'https://grpc', ANCHOR_PACKAGE_ID: '0xpkg',
  ANCHOR_ORIGINAL_PACKAGE_ID: '0xpkg', ENTITY_ID: TEST_ENTITY_ID,
  ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm1', AI_MODEL_COPILOT: 'm2',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});

/**
 * High-confidence TRUTHFUL stub → AUTO routing (0.92 ≥ 0.85 threshold).
 * Echoes the event's real eventType from the prompt: the deterministic AUTO gate (F3)
 * requires LLM agreement with the ingestion-normalized type, so a stub that always
 * answers RECEIPT would (correctly) route every payment to NEEDS_REVIEW.
 */
export const stubClassifyClient: GeminiClient = {
  async generateJson(_model: string, prompt: string) {
    const m = /"eventType"\s*:\s*"([A-Z_]+)"/.exec(prompt);
    if (!m) throw new Error('classify stub: eventType not found in prompt — prompt format changed?');
    return { eventType: m?.[1] ?? 'DIGITAL_ASSET_RECEIPT', economicPurpose: 'RECEIVABLE_SETTLEMENT', counterparty: null, confidence: 0.92, reasoning: 'r' } as never;
  },
};

export const needsReviewClient: GeminiClient = {
  async generateJson() {
    return { eventType: 'DIGITAL_ASSET_RECEIPT', economicPurpose: 'X', counterparty: null, confidence: 0.5, reasoning: 'r' } as never;
  },
};

export async function buildTestApp(
  seedFixture = true,
  client: GeminiClient = stubClassifyClient,
  memory: MemoryClient = new OffMemory(),
  // Default: no real serialization (matches prior behavior for every existing caller).
  // Pass a real makeEntityMutex() (from @subledger/anchor-svc) to test actual mutex-held
  // concurrency guarantees (see monkey.h2.test.ts concurrent-freeze-race scenario).
  mutex: { run<T>(key: string, fn: () => Promise<T>): Promise<T> } = { run: (_k: string, fn: () => Promise<never>) => fn() },
): Promise<FastifyInstance & { _db: Db }> {
  const db = openDb(':memory:');
  // Seed entity "e1" with fixture events (same pattern as routes.test.ts).
  if (seedFixture) {
    seed(db, {
      entityId: TEST_ENTITY_ID,
      entityChainId: '0xchain',
      entityCapId: '0xcap',
      originalPackageId: '0xpkg',
    }, fixture as FixtureBundle);
    // D14: the fixture's RECEIPT (2026-06-01) and PAYMENT (2026-06-02) events require
    // valuation — seed prices for both exact dates so every caller of this shared factory
    // keeps posting, same as the old hardcoded-100 behavior (assertions unchanged).
    insertPricePoint(db, {
      entityId: TEST_ENTITY_ID, coinType: '0x2::sui::SUI', asOf: '2026-06-01',
      priceMinor: '100', quoteCurrency: 'USD', principalMarket: 'manual', source: 'manual', level: 'LEVEL_2',
    });
    insertPricePoint(db, {
      entityId: TEST_ENTITY_ID, coinType: '0x2::sui::SUI', asOf: '2026-06-02',
      priceMinor: '100', quoteCurrency: 'USD', principalMarket: 'manual', source: 'manual', level: 'LEVEL_2',
    });
  }
  const app = Fastify() as unknown as FastifyInstance & { _db: Db };
  app._db = db;
  registerRoutes(app, {
    db, cfg,
    classifyClient: client,
    copilotClient: client,
    anchorAdapter: null as never,
    mutex,
    memory,
  });
  await app.ready();
  return app;
}
