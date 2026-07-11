// Spec 2026-07-11 policyset-coa-persistence. Append-only versioned policy persistence.
// This module is the ONLY writer of policy_sets / coa_mapping_sets / accounts seed rows.
import { z } from 'zod';
import type { Db } from './db.js';
import { DEMO_POLICY_SET, DEMO_COA_RULES, resolveCoa, type CoaRule } from '../http/policyConstants.js';
import type { ResolvedPolicySet, CoaMapping } from '../deps/rulesEngine.js';

export type { CoaRule };

// §9.1 ten policy fields + the 6 version dims + engine's roundingThresholdMinor.
// Superset of the engine's ResolvedPolicySet: the engine consumes a subset (Task 2 loader);
// the §9.1-only fields (accountingStandard, stablecoinTreatment, …) are persisted for the
// upcoming revaluation/close sub-projects and exposed read-only via GET /policy/active.
export const PolicyDocSchema = z.object({
  accountingStandard: z.enum(['IFRS', 'US_GAAP']),
  functionalCurrency: z.string().min(1),
  reportingCurrency: z.string().min(1),
  costBasisMethod: z.enum(['FIFO', 'WAC']),
  stablecoinTreatment: z.enum(['FINANCIAL_ASSET_IFRS9', 'INTANGIBLE_ASSET', 'CASH_EQUIVALENT']),
  cryptoClassificationDefault: z.string().min(1),
  stakingIncomePolicy: z.enum(['OPERATING_REVENUE', 'OTHER_INCOME']),
  feeExpensePolicy: z.enum(['EXPENSE_IMMEDIATE', 'CAPITALIZE_TO_ASSET']),
  revaluationPolicy: z.enum(['cost', 'revaluation']),
  asu202308Applies: z.record(z.string(), z.boolean()),
  policySetVersion: z.string().min(1),
  assetPolicyVersion: z.string().min(1),
  eventPolicyVersion: z.string().min(1),
  ruleVersion: z.string().min(1),
  parserVersion: z.string().min(1),
  normalizationVersion: z.string().min(1),
  roundingThresholdMinor: z.string().regex(/^\d+$/),
}).strict();
export type PolicyDoc = z.infer<typeof PolicyDocSchema>;

// Seed doc = the demo constant's 6 version dims verbatim + §9.1 values matching TODAY's
// hardwired engine behaviour (buildRuleInput.ts pins INTANGIBLE_IAS38_COST / IAS38_COST,
// i.e. IFRS cost track). These are policy DEFAULTS, editable via PATCH (Task 4).
export const SEED_POLICY_DOC: PolicyDoc = {
  accountingStandard: 'IFRS',
  functionalCurrency: DEMO_POLICY_SET.functionalCurrency,
  reportingCurrency: 'USD',
  costBasisMethod: DEMO_POLICY_SET.costBasisMethod,
  stablecoinTreatment: 'FINANCIAL_ASSET_IFRS9',
  cryptoClassificationDefault: 'INTANGIBLE_IAS38_COST',
  stakingIncomePolicy: 'OTHER_INCOME',
  feeExpensePolicy: 'EXPENSE_IMMEDIATE',
  revaluationPolicy: 'cost',
  asu202308Applies: {},
  policySetVersion: DEMO_POLICY_SET.policySetVersion,
  assetPolicyVersion: DEMO_POLICY_SET.assetPolicyVersion,
  eventPolicyVersion: DEMO_POLICY_SET.eventPolicyVersion,
  ruleVersion: DEMO_POLICY_SET.ruleVersion,
  parserVersion: DEMO_POLICY_SET.parserVersion,
  normalizationVersion: DEMO_POLICY_SET.normalizationVersion,
  roundingThresholdMinor: DEMO_POLICY_SET.roundingThresholdMinor,
};

// §10.3 seed list: 7 legacy (in DEMO_COA_RULES today) + 8 new MVP + 1 reserved P1.
export const ACCOUNT_SEED: Array<{ name: string; class: 'asset' | 'liability' | 'equity' | 'income' | 'expense'; sourceSection: string; status: 'active' | 'reserved_p1' }> = [
  { name: 'DigitalAssets',            class: 'asset',     sourceSection: '§10.3', status: 'active' },
  { name: 'AccountsReceivable',       class: 'asset',     sourceSection: '§10.3', status: 'active' },
  { name: 'AccountsPayable',          class: 'liability', sourceSection: '§10.3', status: 'active' },
  { name: 'DisposalGain',             class: 'income',    sourceSection: '§10.3', status: 'active' },
  { name: 'DisposalLoss',             class: 'expense',   sourceSection: '§10.3', status: 'active' },
  { name: 'GasFeeExpense',            class: 'expense',   sourceSection: '§10.3', status: 'active' },
  { name: 'OpeningBalanceEquity',     class: 'equity',    sourceSection: '§7.3',  status: 'active' },
  { name: 'StakingIncome',            class: 'income',    sourceSection: '§4.1.1', status: 'active' },
  { name: 'RoundingDifference',       class: 'expense',   sourceSection: '§4.0',  status: 'active' },
  { name: 'UnrealizedGainCryptoPnL',  class: 'income',    sourceSection: '§5.1',  status: 'active' },
  { name: 'UnrealizedLossCryptoPnL',  class: 'expense',   sourceSection: '§5.1',  status: 'active' },
  { name: 'ImpairmentLoss',           class: 'expense',   sourceSection: '§5.2',  status: 'active' },
  { name: 'ImpairmentReversalGain',   class: 'income',    sourceSection: '§5.2',  status: 'active' },
  { name: 'GasRebateIncome',          class: 'income',    sourceSection: '§4.4.1', status: 'active' },
  { name: 'RetainedEarnings',         class: 'equity',    sourceSection: '§7.3',  status: 'active' },
  { name: 'RevaluationSurplus',       class: 'equity',    sourceSection: '§5.3',  status: 'reserved_p1' },
];

// Server-computed version bump (spec §4 V1/V2): trailing integer increments; a version
// string with no trailing integer gets '-2' appended. Clients never supply versions.
export function bumpVersion(v: string): string {
  const m = /^(.*?)(\d+)$/.exec(v);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${v}-2`;
}

// Idempotent: seeds version 1 + accounts for every entity that has none yet. Runs at
// every openDb (fresh DBs, legacy DBs, and entities inserted before this feature).
// Entities inserted AFTER boot are seeded by insertEntity's caller path re-running this
// (cheap: one SELECT per entity when already seeded).
export function ensurePolicySeed(db: Db): void {
  const entities = db.prepare('SELECT id FROM entities').all() as Array<{ id: string }>;
  const now = new Date().toISOString();
  const insPs = db.prepare('INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by) VALUES (?, 1, ?, ?, ?)');
  const insCoa = db.prepare('INSERT INTO coa_mapping_sets (entity_id, version, rules, rule_version, created_at, created_by) VALUES (?, 1, ?, ?, ?, ?)');
  const insAcct = db.prepare('INSERT OR IGNORE INTO accounts (entity_id, name, class, source_section, status) VALUES (?, ?, ?, ?, ?)');
  const hasPs = db.prepare('SELECT 1 FROM policy_sets WHERE entity_id = ? LIMIT 1');
  const hasCoa = db.prepare('SELECT 1 FROM coa_mapping_sets WHERE entity_id = ? LIMIT 1');
  const seedAll = db.transaction(() => {
    for (const { id } of entities) {
      if (!hasPs.get(id)) insPs.run(id, JSON.stringify(SEED_POLICY_DOC), now, 'seed');
      if (!hasCoa.get(id)) insCoa.run(id, JSON.stringify(DEMO_COA_RULES), SEED_POLICY_DOC.ruleVersion, now, 'seed');
      for (const a of ACCOUNT_SEED) insAcct.run(id, a.name, a.class, a.sourceSection, a.status);
    }
  });
  seedAll();
}

export class PolicyPersistenceError extends Error {
  constructor(public readonly code: 'POLICY_MISSING' | 'POLICY_CORRUPT', message: string) {
    super(message);
    this.name = 'PolicyPersistenceError';
  }
}

export const CoaRulesSchema = z.array(z.object({
  eventType: z.string().min(1), leg: z.string().min(1), account: z.string().min(1),
}).strict()).nonempty();

// Task 4/5 shared writer: appends a new policy_sets row for entityId (MAX(version)+1) and
// returns the new version number. Callers wrap this + appendChange in one db.transaction so
// a change_log write failure rolls the version row back too.
export function insertPolicyVersion(db: Db, entityId: string, doc: PolicyDoc, createdBy: string): number {
  const cur = db.prepare('SELECT MAX(version) AS v FROM policy_sets WHERE entity_id = ?').get(entityId) as { v: number | null };
  const next = (cur.v ?? 0) + 1;
  db.prepare('INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(entityId, next, JSON.stringify(PolicyDocSchema.parse(doc)), new Date().toISOString(), createdBy);
  return next;
}

// Task 5 V1 writer: appends a new coa_mapping_sets row for entityId (MAX(version)+1). Callers
// wrap this + insertPolicyVersion + appendChange in one db.transaction (the V1 invariant: a
// rule-mapping change and its ruleVersion bump land atomically or not at all).
export function insertCoaMappingVersion(db: Db, entityId: string, rules: CoaRule[], ruleVersion: string, createdBy: string): number {
  const cur = db.prepare('SELECT MAX(version) AS v FROM coa_mapping_sets WHERE entity_id = ?').get(entityId) as { v: number | null };
  const next = (cur.v ?? 0) + 1;
  db.prepare('INSERT INTO coa_mapping_sets (entity_id, version, rules, rule_version, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entityId, next, JSON.stringify(CoaRulesSchema.parse(rules)), ruleVersion, new Date().toISOString(), createdBy);
  return next;
}

export function getActivePolicy(db: Db, entityId: string): { version: number; doc: PolicyDoc } {
  const row = db.prepare(
    'SELECT version, doc FROM policy_sets WHERE entity_id = ? ORDER BY version DESC LIMIT 1',
  ).get(entityId) as { version: number; doc: string } | undefined;
  if (!row) throw new PolicyPersistenceError('POLICY_MISSING', `no policy_sets row for entity ${entityId}; seed missing`);
  let parsed: unknown;
  try { parsed = JSON.parse(row.doc); } catch {
    throw new PolicyPersistenceError('POLICY_CORRUPT', `policy_sets v${row.version} for ${entityId}: doc is not JSON`);
  }
  const v = PolicyDocSchema.safeParse(parsed);
  if (!v.success) throw new PolicyPersistenceError('POLICY_CORRUPT', `policy_sets v${row.version} for ${entityId}: ${v.error.message}`);
  return { version: row.version, doc: v.data };
}

export function getActiveCoaMapping(db: Db, entityId: string): { version: number; ruleVersion: string; rules: CoaRule[] } {
  const row = db.prepare(
    'SELECT version, rules, rule_version FROM coa_mapping_sets WHERE entity_id = ? ORDER BY version DESC LIMIT 1',
  ).get(entityId) as { version: number; rules: string; rule_version: string } | undefined;
  if (!row) throw new PolicyPersistenceError('POLICY_MISSING', `no coa_mapping_sets row for entity ${entityId}; seed missing`);
  let parsed: unknown;
  try { parsed = JSON.parse(row.rules); } catch {
    throw new PolicyPersistenceError('POLICY_CORRUPT', `coa_mapping_sets v${row.version} for ${entityId}: rules is not JSON`);
  }
  const v = CoaRulesSchema.safeParse(parsed);
  if (!v.success) throw new PolicyPersistenceError('POLICY_CORRUPT', `coa_mapping_sets v${row.version} for ${entityId}: ${v.error.message}`);
  return { version: row.version, ruleVersion: row.rule_version, rules: v.data };
}

// Engine consumes a SUBSET of the doc (ResolvedPolicySet). §9.1-only fields ride along in
// the doc for later sub-projects; costBasisMethod narrows to 'FIFO' because the engine
// type pins it — 'WAC' docs are storable (P1) but not yet executable.
export function toResolvedPolicySet(doc: PolicyDoc, periodOpen: boolean): ResolvedPolicySet {
  if (doc.costBasisMethod !== 'FIFO') {
    throw new PolicyPersistenceError('POLICY_CORRUPT', `costBasisMethod ${doc.costBasisMethod} not executable in MVP (engine pins FIFO)`);
  }
  return {
    policySetVersion: doc.policySetVersion, assetPolicyVersion: doc.assetPolicyVersion,
    eventPolicyVersion: doc.eventPolicyVersion, ruleVersion: doc.ruleVersion,
    parserVersion: doc.parserVersion, normalizationVersion: doc.normalizationVersion,
    costBasisMethod: doc.costBasisMethod, functionalCurrency: doc.functionalCurrency,
    roundingThresholdMinor: doc.roundingThresholdMinor, periodOpen,
  };
}

export function buildCoaMappingFromRules(rules: CoaRule[]): CoaMapping {
  return { resolve: ({ eventType, leg }) => resolveCoa({ eventType: eventType as unknown as string, leg }, rules) };
}
