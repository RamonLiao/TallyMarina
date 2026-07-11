import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { loadConfig } from '../src/config.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';
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
let db: Db;

beforeEach(async () => {
  db = openDb(':memory:');
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

describe('PATCH /policy/policy-set (Task 4)', () => {
  const url = '/policy/policy-set';
  const base = { entity: 'acme:pilot-001', actor: 'controller-a', reason: 'switch to GAAP for pilot' };

  it('bumps policySetVersion, inserts version 2, appends change_log', async () => {
    const res = await app.inject({ method: 'PATCH', url, payload: { ...base, changes: { accountingStandard: 'US_GAAP' } } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.policyVersion).toBe(2);
    expect(body.policyDoc.accountingStandard).toBe('US_GAAP');
    expect(body.policyDoc.policySetVersion).toBe('demo-ps-2');       // server-computed bump
    expect(body.policyDoc.ruleVersion).toBe('demo-rule-1');          // untouched by policy-field edits
    const log = db.prepare("SELECT object_type, before, after, reason, actor FROM change_log ORDER BY seq").all() as Array<Record<string, string>>;
    expect(log).toHaveLength(1);
    expect(log[0]!.object_type).toBe('policy_set');
    expect(JSON.parse(log[0]!.before!).accountingStandard).toBe('IFRS');
    expect(JSON.parse(log[0]!.after!).accountingStandard).toBe('US_GAAP');
    expect(log[0]!.reason).toBe(base.reason);
  });

  it('409 NO_CHANGE when the merged doc equals the active doc', async () => {
    const res = await app.inject({ method: 'PATCH', url, payload: { ...base, changes: { accountingStandard: 'IFRS' } } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_CHANGE');
    expect((db.prepare('SELECT COUNT(*) AS n FROM policy_sets').get() as { n: number }).n).toBe(1); // no version bloat
  });

  it('409 NO_CHANGE when asu202308Applies is re-sent with reordered keys (canonical deep-equal)', async () => {
    const first = await app.inject({
      method: 'PATCH', url,
      payload: { ...base, changes: { asu202308Applies: { '0xb': true, '0xa': false } } },
    });
    expect(first.statusCode).toBe(200);
    const countAfterFirst = (db.prepare('SELECT COUNT(*) AS n FROM policy_sets').get() as { n: number }).n;

    const second = await app.inject({
      method: 'PATCH', url,
      payload: { ...base, changes: { asu202308Applies: { '0xa': false, '0xb': true } } },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('NO_CHANGE');
    expect((db.prepare('SELECT COUNT(*) AS n FROM policy_sets').get() as { n: number }).n).toBe(countAfterFirst);
  });

  it('400 CURRENCY_LOCKED on functionalCurrency change', async () => {
    const res = await app.inject({ method: 'PATCH', url, payload: { ...base, changes: { functionalCurrency: 'TWD' } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CURRENCY_LOCKED');
  });

  it('400 VALIDATION on unknown field (.strict() rejection)', async () => {
    const res = await app.inject({ method: 'PATCH', url, payload: { ...base, changes: { policySetVersion: 'hax-1' } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('400s: empty reason / unknown field / currency change / bad enum / missing entity', async () => {
    for (const payload of [
      { ...base, reason: '  ', changes: { accountingStandard: 'US_GAAP' } },
      { ...base, changes: { policySetVersion: 'hax-1' } },              // version fields not editable (.strict())
      { ...base, changes: { functionalCurrency: 'TWD' } },              // CURRENCY_LOCKED
      { ...base, changes: { costBasisMethod: 'LIFO' } },
      { entity: '', actor: 'a', reason: 'r', changes: { accountingStandard: 'US_GAAP' } },
    ]) {
      const res = await app.inject({ method: 'PATCH', url, payload });
      expect([400, 404]).toContain(res.statusCode);
    }
    expect((db.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number }).n).toBe(0);
  });
});
