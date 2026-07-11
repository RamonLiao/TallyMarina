import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { loadConfig } from '../src/config.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import { insertEntity } from '../src/store/entityStore.js';
import { ensurePolicySeed } from '../src/store/policyStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
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
const P = '2026-Q2';

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

// Task 3 fixture pattern (runRules.policyVersion.test.ts): seed an event and drive it
// INGESTED->AUTO deterministically (no LLM) so run-rules picks it up.
function openingLot(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'v1', eventId: 'evt', eventType: 'OPENING_LOT', eventGroupId: null,
    entityId: E, bookId: 'main', wallet: '0xacme', counterparty: null, coinType: '0x2::sui::SUI',
    assetDecimals: 9, quantityMinor: '1000000000', eventTime: '2026-04-01T00:00:00Z',
    economicPurpose: 'OPENING_BALANCE', ownershipChange: true, openingCostMinor: '500000',
    considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    rawPayloadHash: 'deadbeef', txDigest: 'DIG', eventIndex: 0, ...over,
  };
}

function seedAuto(id: string, raw: Record<string, unknown>): void {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify(raw) });
  setAiSuggestion(db, id, {
    aiEventType: raw.eventType as string, aiPurpose: 'seed', aiCounterparty: null,
    aiConfidence: 0.9, aiReasoning: 'seed', nextStatus: 'AUTO',
  });
}

describe('PUT /policy/coa-mapping (Task 5)', () => {
  const url = '/policy/coa-mapping';
  const base = { entity: E, actor: 'controller-a', reason: 'route gas to StakingIncome demo' };
  const withRuleChanged = () => {
    const rules = structuredClone(DEMO_COA_RULES);
    rules.find((r) => r.eventType === 'GAS_FEE' && r.leg === 'NETWORK_FEE')!.account = 'GasRebateIncome';
    return rules;
  };

  it('V1: one transaction bumps ruleVersion, inserts coa v2 AND policy v2, logs twice', async () => {
    const res = await app.inject({ method: 'PUT', url, payload: { ...base, rules: withRuleChanged() } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coaVersion).toBe(2);
    expect(body.ruleVersion).toBe('demo-rule-2');
    expect(body.policyVersion).toBe(2);
    const doc = JSON.parse((db.prepare("SELECT doc FROM policy_sets WHERE version=2").get() as { doc: string }).doc);
    expect(doc.ruleVersion).toBe('demo-rule-2');
    expect(doc.policySetVersion).toBe('demo-ps-1'); // policy-field identity unchanged; only the rule dim moved
    const log = db.prepare('SELECT object_type FROM change_log ORDER BY seq').all() as Array<{ object_type: string }>;
    expect(log.map((l) => l.object_type)).toEqual(['mapping_rule', 'policy_set']);
  });

  it('rejects: unknown account / reserved_p1 account / duplicate (eventType,leg) / empty rules / empty reason', async () => {
    const dup = structuredClone(DEMO_COA_RULES); dup.push({ ...dup[0]! });
    const unknown = withRuleChanged(); unknown[0] = { ...unknown[0]!, account: 'NoSuchAccount' };
    const reserved = withRuleChanged(); reserved[0] = { ...reserved[0]!, account: 'RevaluationSurplus' };
    for (const payload of [
      { ...base, rules: unknown }, { ...base, rules: reserved },
      { ...base, rules: dup }, { ...base, rules: [] },
      { ...base, reason: '', rules: withRuleChanged() },
    ]) {
      const res = await app.inject({ method: 'PUT', url, payload });
      expect(res.statusCode).toBe(400);
    }
    expect((db.prepare('SELECT COUNT(*) AS n FROM coa_mapping_sets').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number }).n).toBe(0);
  });

  it('409 NO_CHANGE on identical rules', async () => {
    const res = await app.inject({ method: 'PUT', url, payload: { ...base, rules: structuredClone(DEMO_COA_RULES) } });
    expect(res.statusCode).toBe(409);
  });

  // The hole this design closes (spec §4 V1): after a mapping change, the SAME event
  // must produce a DIFFERENT idempotency key (ruleVersion is a key ingredient), so the
  // old JE and the new-rules JE can coexist instead of colliding on the corruption guard.
  it('same event re-evaluated after a mapping change yields a different idempotency key', async () => {
    seedAuto('open1', openingLot({ eventId: 'open1' }));
    const r1 = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r1.statusCode).toBe(200);

    const key1 = (db.prepare('SELECT idempotency_key FROM journal_entries').get() as { idempotency_key: string }).idempotency_key;

    const putRes = await app.inject({ method: 'PUT', url, payload: { ...base, rules: withRuleChanged() } });
    expect(putRes.statusCode).toBe(200);

    // Re-approve the same event so run-rules picks it up again as a candidate.
    db.prepare("UPDATE events SET status = 'APPROVED' WHERE id = ?").run('open1');
    const r2 = await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } });
    expect(r2.statusCode).toBe(200);

    const keys = db.prepare('SELECT idempotency_key, rule_version FROM journal_entries ORDER BY rowid')
      .all() as Array<{ idempotency_key: string; rule_version: string }>;
    expect(keys).toHaveLength(2);
    expect(keys[1]!.idempotency_key).not.toBe(key1);   // versions moved -> key moved -> no collision
    // Provenance: the second JE's rule_version comes from the mapping actually used to post it.
    expect(keys[1]!.rule_version).toBe('demo-rule-2');
  });
});
