import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { loadConfig } from '../src/config.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import { DEMO_POLICY_SET, DEMO_COA_RULES, DEMO_DEFAULT_ACCOUNT } from '../src/http/policyConstants.js';

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
  app = Fastify();
  registerRoutes(app, {
    db, cfg, classifyClient: stubClient, copilotClient: stubClient,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
  });
  await app.ready();
});

describe('GET /policy/active', () => {
  it('returns the active policy set, serializable COA rules, and periodId', async () => {
    const res = await app.inject({ method: 'GET', url: '/policy/active' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      policySet: typeof DEMO_POLICY_SET;
      coaMapping: { rules: typeof DEMO_COA_RULES; defaultAccount: string };
      periodId: string;
    };
    expect(body.policySet).toEqual(DEMO_POLICY_SET);
    expect(body.coaMapping.rules).toEqual(DEMO_COA_RULES);
    expect(body.coaMapping.defaultAccount).toBe(DEMO_DEFAULT_ACCOUNT);
    expect(typeof body.periodId).toBe('string');
    expect(body.periodId).toBe('2026-Q2');
  });
});
