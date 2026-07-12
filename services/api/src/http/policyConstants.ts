import type { ResolvedPolicySet, CoaMapping } from '../deps/rulesEngine.js';

export const DEMO_POLICY_SET: ResolvedPolicySet = {
  policySetVersion: 'demo-ps-1', assetPolicyVersion: 'demo-ap-1', eventPolicyVersion: 'demo-ep-1',
  ruleVersion: 'demo-rule-1', parserVersion: 'demo-parse-1', normalizationVersion: 'demo-norm-1',
  costBasisMethod: 'FIFO', functionalCurrency: 'USD', roundingThresholdMinor: '0', periodOpen: true,
};

export interface CoaRule { eventType: string; leg: string; account: string } // leg '*' = catch-all

// Explicit per-leg mapping using the REAL leg names the rules engine emits
// (receiptRules/paymentRules/gasRules/swapRules/internalTransferRules). The previous
// 'L1' rows never matched any real leg, so every line silently fell through to the
// Suspense fallback — review C3 (2026-07-03). There is NO default account anymore:
// an unmapped leg resolves to null and fail-closes as MAPPING_MISSING (spec §6.5, A.2).
export const DEMO_COA_RULES: CoaRule[] = [
  { eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'ACQUISITION', account: 'DigitalAssets' },
  { eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'RECEIVABLE_SETTLEMENT', account: 'AccountsReceivable' },
  { eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'EXPENSE', account: 'AccountsPayable' },
  { eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'DISPOSAL', account: 'DigitalAssets' },
  { eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'DISPOSAL_GAIN', account: 'DisposalGain' },
  { eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'DISPOSAL_LOSS', account: 'DisposalLoss' },
  { eventType: 'GAS_FEE', leg: 'NETWORK_FEE', account: 'GasFeeExpense' },
  { eventType: 'GAS_FEE', leg: 'DISPOSAL', account: 'DigitalAssets' },
  { eventType: 'GAS_FEE', leg: 'DISPOSAL_GAIN', account: 'DisposalGain' },
  { eventType: 'GAS_FEE', leg: 'DISPOSAL_LOSS', account: 'DisposalLoss' },
  // §4.4.1: gas 淨額為負（rebate > 成本）——比照 §4.1 建新 lot，貸方 contra-expense（沖減
  // 當期 GasFeeExpense，以其累計為限）+ 其他收入（GasRebateIncome）。
  { eventType: 'GAS_FEE', leg: 'ACQUISITION', account: 'DigitalAssets' },
  { eventType: 'GAS_FEE', leg: 'REBATE_CONTRA', account: 'GasFeeExpense' },
  { eventType: 'GAS_FEE', leg: 'REBATE_INCOME', account: 'GasRebateIncome' },
  { eventType: 'OPENING_LOT', leg: 'ACQUISITION', account: 'DigitalAssets' },
  { eventType: 'OPENING_LOT', leg: 'OPENING_EQUITY', account: 'OpeningBalanceEquity' },
  { eventType: 'SPOT_TRADE_SWAP', leg: 'ACQUISITION', account: 'DigitalAssets' },
  { eventType: 'SPOT_TRADE_SWAP', leg: 'DISPOSAL', account: 'DigitalAssets' },
  { eventType: 'SPOT_TRADE_SWAP', leg: 'DISPOSAL_GAIN', account: 'DisposalGain' },
  { eventType: 'SPOT_TRADE_SWAP', leg: 'DISPOSAL_LOSS', account: 'DisposalLoss' },
  // §4.5 (CPA B1, Task 10): reclassification legs for disposing a GAAP_FV-revalued lot —
  // previously recognized unrealized gain/loss moves out of the Unrealized* P&L account into
  // Disposal* on the SAME swap eventType (swapRules emits these legs; without a mapping the
  // reclass lines 400 as MAPPING_MISSING and the whole disposal event is skipped, never a
  // partial post — spec §6.5, A.2).
  { eventType: 'SPOT_TRADE_SWAP', leg: 'UNREALIZED_GAIN_RECLASS', account: 'UnrealizedGainCryptoPnL' },
  { eventType: 'SPOT_TRADE_SWAP', leg: 'UNREALIZED_LOSS_RECLASS', account: 'UnrealizedLossCryptoPnL' },
  // INTERNAL_TRANSFER legs are dynamic (WALLET:<addr>) — the catch-all is intentional.
  { eventType: 'INTERNAL_TRANSFER', leg: '*', account: 'DigitalAssets' },
];

export function resolveCoa(args: { eventType: string; leg: string }, rules: CoaRule[] = DEMO_COA_RULES): string | null {
  const hit = rules.find((r) => r.eventType === args.eventType && (r.leg === args.leg || r.leg === '*'));
  return hit ? hit.account : null;
}

export function buildCoaMapping(): CoaMapping {
  return { resolve: ({ eventType, leg }) => resolveCoa({ eventType: eventType as unknown as string, leg }) };
}
