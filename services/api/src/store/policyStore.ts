// Spec 2026-07-11 policyset-coa-persistence. Append-only versioned policy persistence.
// This module is the ONLY writer of policy_sets / coa_mapping_sets / accounts seed rows.
import { z } from 'zod';
import type { Db } from './db.js';
import { DEMO_POLICY_SET, DEMO_COA_RULES, type CoaRule } from '../http/policyConstants.js';

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
