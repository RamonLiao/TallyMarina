import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { loadConfig } from '../src/config.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import { DEMO_POLICY_SET, DEMO_COA_RULES } from '../src/http/policyConstants.js';
import { insertEntity } from '../src/store/entityStore.js';
import { ensurePolicySeed } from '../src/store/policyStore.js';

const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'https://grpc', ANCHOR_PACKAGE_ID: '0xpkg',
  ANCHOR_ORIGINAL_PACKAGE_ID: '0xpkg', ENTITY_ID: 'acme:pilot-001',
  ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm1', AI_MODEL_COPILOT: 'm2',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});

const stubClient: GeminiClient = {
  async generateJson() { return {} as never; },
};

let app: FastifyInstance;

beforeEach(async () => {
  const db = openDb(':memory:');
  // openDb's ensurePolicySeed ran before this entity existed; insert it then re-run so
  // /policy/active (which now requires the entity + a persisted policy row) has both.
  insertEntity(db, { id: cfg.entityId, displayName: 'Acme', chainObjectId: '0xchain', capObjectId: '0xcap', originalPackageId: '0xpkg' });
  ensurePolicySeed(db);
  app = Fastify();
  registerRoutes(app, {
    db, cfg, classifyClient: stubClient, copilotClient: stubClient,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    memory: new OffMemory(),
  });
  await app.ready();
});

describe('GET /policy/active', () => {
  it('returns the active policy set, serializable COA rules, and periodId', async () => {
    const res = await app.inject({ method: 'GET', url: '/policy/active' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      policySet: typeof DEMO_POLICY_SET;
      coaMapping: { rules: typeof DEMO_COA_RULES; defaultAccount: string | null };
      periodId: string;
    };
    expect(body.policySet).toEqual(DEMO_POLICY_SET);
    expect(body.coaMapping.rules).toEqual(DEMO_COA_RULES);
    // Fail-closed: no suspense default — unmapped legs must MAPPING_MISSING (review C3).
    expect(body.coaMapping.defaultAccount).toBeNull();
    expect(typeof body.periodId).toBe('string');
    expect(body.periodId).toBe('2026-Q2');
  });

  it('exposes the persisted doc and versions (additive fields)', async () => {
    const res = await app.inject({ method: 'GET', url: '/policy/active' });
    const body = res.json();
    expect(body.policyVersion).toBe(1);
    expect(body.coaVersion).toBe(1);
    expect(body.policyDoc.accountingStandard).toBe('IFRS');
    expect(body.policySet).toEqual(expect.objectContaining({ policySetVersion: 'demo-ps-1' })); // legacy shape intact
  });
});
