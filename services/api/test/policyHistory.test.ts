import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { loadConfig } from '../src/config.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import { insertEntity } from '../src/store/entityStore.js';
import { ensurePolicySeed } from '../src/store/policyStore.js';
import { DEMO_COA_RULES } from '../src/http/policyConstants.js';

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

const E = 'acme:pilot-001';

let app: FastifyInstance;
let db: Db;

beforeEach(async () => {
  db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0xchain', capObjectId: '0xcap', originalPackageId: '0xpkg' });
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

describe('GET /policy/history (Task 6)', () => {
  it('400 VALIDATION when entity is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/policy/history' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('returns change_log (seq DESC) + policy/coa version lists after one PATCH and one PUT', async () => {
    const patchRes = await app.inject({
      method: 'PATCH', url: '/policy/policy-set',
      payload: { entity: E, actor: 'controller-a', reason: 'switch to GAAP', changes: { accountingStandard: 'US_GAAP' } },
    });
    expect(patchRes.statusCode).toBe(200);

    const rules = structuredClone(DEMO_COA_RULES);
    rules.find((r) => r.eventType === 'GAS_FEE' && r.leg === 'NETWORK_FEE')!.account = 'GasRebateIncome';
    const putRes = await app.inject({
      method: 'PUT', url: '/policy/coa-mapping',
      payload: { entity: E, actor: 'controller-a', reason: 'route gas to StakingIncome demo', rules },
    });
    expect(putRes.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/policy/history?entity=${E}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.changes).toHaveLength(3);
    expect(body.changes[0].seq).toBeGreaterThan(body.changes[2].seq);

    expect(body.policyVersions).toHaveLength(3); // seed v1 + PATCH v2 + PUT's policy_set v3
    expect(body.coaVersions).toHaveLength(2);    // seed v1 + PUT v2
  });
});
