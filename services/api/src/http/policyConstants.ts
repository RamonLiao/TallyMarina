import type { ResolvedPolicySet, CoaMapping } from '../deps/rulesEngine.js';

export const DEMO_POLICY_SET: ResolvedPolicySet = {
  policySetVersion: 'demo-ps-1', assetPolicyVersion: 'demo-ap-1', eventPolicyVersion: 'demo-ep-1',
  ruleVersion: 'demo-rule-1', parserVersion: 'demo-parse-1', normalizationVersion: 'demo-norm-1',
  costBasisMethod: 'FIFO', functionalCurrency: 'USD', roundingThresholdMinor: '0', periodOpen: true,
};

export interface CoaRule { eventType: string; leg: string; account: string } // leg '*' = catch-all

// Serializable table mirroring the ORIGINAL buildRuleInput closure semantics, rule order significant.
export const DEMO_COA_RULES: CoaRule[] = [
  { eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'DigitalAssets' },
  { eventType: 'DIGITAL_ASSET_RECEIPT', leg: '*',  account: 'AccountsReceivable' },
  { eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'L1', account: 'AccountsPayable' },
  { eventType: 'DIGITAL_ASSET_PAYMENT', leg: '*',  account: 'DigitalAssets' },
];

export const DEMO_DEFAULT_ACCOUNT = 'Suspense';

export function resolveCoa(args: { eventType: string; leg: string }, rules: CoaRule[] = DEMO_COA_RULES, fallback: string = DEMO_DEFAULT_ACCOUNT): string {
  const hit = rules.find((r) => r.eventType === args.eventType && (r.leg === args.leg || r.leg === '*'));
  return hit ? hit.account : fallback;
}

export function buildCoaMapping(): CoaMapping {
  return { resolve: ({ eventType, leg }) => resolveCoa({ eventType: eventType as unknown as string, leg }) };
}
