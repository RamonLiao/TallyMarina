import type { EventStrategy, LotPlan } from './registry.js';
import type { PipelineCtx } from '../pipeline/context.js';
import type { JeLine, Measurement, DisclosureFact, RuleException } from '../domain/types.js';
import { subMinor, ltMinor, negMinor, isZeroMinor } from '../core/decimal.js';
import { balanceCheck } from './receiptRules.js';
import { paymentStrategy } from './paymentRules.js';

// §4.4.1 (D9): gas 淨額 = computation + storage − rebate 可為負（entity 淨收 SUI）。此時非
// §4.4 支出模板而比照 §4.1 建新 lot（contra-expense + 其他收入兩段貸方）。quantityMinor 之
// schema 強制正整數（^[1-9]\d*$），無法用負號傳遞方向，故淨額為負由上游 normalization 以
// economicPurpose = 'NETWORK_FEE_REBATE' 標記；quantityMinor 仍代表 |淨額|。
const NEGATIVE_NET_PURPOSE = 'NETWORK_FEE_REBATE';
function isNegativeNet(ctx: PipelineCtx): boolean {
  return ctx.input.event.economicPurpose === NEGATIVE_NET_PURPOSE;
}

function buildNegativeNetLotPlan(ctx: PipelineCtx): LotPlan {
  const { event } = ctx.input;
  const fv = ctx.carry.fvFunctionalMinor as string;
  return {
    movements: [{ lotId: `GAS-${event.txDigest}-${event.eventIndex}`, coinType: event.coinType, wallet: event.wallet, deltaQtyMinor: event.quantityMinor, deltaCostMinor: fv }],
    consumed: [],
  };
}

function buildNegativeNetMeasurements(ctx: PipelineCtx): Measurement[] {
  const fv = ctx.carry.fvFunctionalMinor as string;
  return [{ name: 'consideration_fv', amountMinor: fv, currency: ctx.input.policySet.functionalCurrency, track: 'FV' }];
}

// min(|淨額| FV, 當期已認列 GasFeeExpense 累計) — 貸方沖減 GasFeeExpense 之上限，不得使該
// 科目轉為貸方淨額（§4.4.1 貸方順序）。
function contraCapMinor(fv: string, gasExpenseToDate: string): string {
  return ltMinor(fv, gasExpenseToDate) ? fv : gasExpenseToDate;
}

function buildNegativeNetJeLines(ctx: PipelineCtx): JeLine[] | RuleException {
  const { event, coaMapping, runContext } = ctx.input;
  const fv = ctx.carry.fvFunctionalMinor as string;
  const gasExpenseToDate = runContext.gasExpenseToDateMinor ?? '0';
  const assetAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: 'ACQUISITION', coinType: event.coinType });
  const contraAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: 'REBATE_CONTRA', coinType: event.coinType });
  const incomeAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: 'REBATE_INCOME', coinType: event.coinType });
  if (!assetAcct || !contraAcct || !incomeAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: { assetAcct, contraAcct, incomeAcct } };
  const contraAmt = contraCapMinor(fv, gasExpenseToDate);
  const incomeAmt = subMinor(fv, contraAmt);
  const lines: JeLine[] = [
    { account: assetAcct, side: 'DEBIT', amountMinor: fv, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'ACQUISITION' },
  ];
  if (!isZeroMinor(contraAmt)) {
    lines.push({ account: contraAcct, side: 'CREDIT', amountMinor: contraAmt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'REBATE_CONTRA' });
  }
  if (!isZeroMinor(incomeAmt)) {
    lines.push({ account: incomeAcct, side: 'CREDIT', amountMinor: incomeAmt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'REBATE_INCOME' });
  }
  return balanceCheck(lines);
}

function buildNegativeNetDisclosure(ctx: PipelineCtx): DisclosureFact[] {
  const fv = ctx.carry.fvFunctionalMinor as string;
  const gasExpenseToDate = ctx.input.runContext.gasExpenseToDateMinor ?? '0';
  const contraAmt = contraCapMinor(fv, gasExpenseToDate);
  return [{ kind: 'gas_rebate', detail: { netInflowFv: fv, contra: contraAmt, income: subMinor(fv, contraAmt) } }];
}

export const gasStrategy: EventStrategy = {
  ruleIds: ['gas-fee-expense-v1', 'gas-derecognition-v1', 'gas-negative-net-v1'],
  requiresValuation: true,
  classify: () => null,
  buildLotPlan: (ctx): LotPlan | RuleException =>
    isNegativeNet(ctx) ? buildNegativeNetLotPlan(ctx) : paymentStrategy.buildLotPlan(ctx),
  buildMeasurements: (ctx): Measurement[] =>
    isNegativeNet(ctx) ? buildNegativeNetMeasurements(ctx) : paymentStrategy.buildMeasurements(ctx),
  buildJeLines: (ctx): JeLine[] | RuleException => {
    if (isNegativeNet(ctx)) return buildNegativeNetJeLines(ctx);
    const { event, coaMapping } = ctx.input;
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    const gain = subMinor(fv, carrying);
    const feeAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: 'NETWORK_FEE', coinType: event.coinType });
    const assetAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: 'DISPOSAL', coinType: event.coinType });
    if (!feeAcct || !assetAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: {} };
    const lines: JeLine[] = [
      { account: feeAcct, side: 'DEBIT', amountMinor: fv, origCoinType: null, origQtyMinor: null, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'NETWORK_FEE' },
      { account: assetAcct, side: 'CREDIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'DISPOSAL' },
    ];
    if (!isZeroMinor(gain)) {
      const gainLeg = ltMinor(gain, '0') ? 'DISPOSAL_LOSS' : 'DISPOSAL_GAIN';
      const gainAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: gainLeg, coinType: event.coinType });
      if (!gainAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: { gainLeg } };
      if (ltMinor(gain, '0')) {
        lines.push({ account: gainAcct, side: 'DEBIT', amountMinor: negMinor(gain), origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_LOSS' });
      } else {
        lines.push({ account: gainAcct, side: 'CREDIT', amountMinor: gain, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_GAIN' });
      }
    }
    return balanceCheck(lines);
  },
  buildDisclosure: (ctx): DisclosureFact[] => {
    if (isNegativeNet(ctx)) return buildNegativeNetDisclosure(ctx);
    return [
      { kind: 'gas_fee', detail: { feeExpense: ctx.carry.fvFunctionalMinor, disposalGain: subMinor(ctx.carry.fvFunctionalMinor as string, ctx.carry.carryingMinor as string) } },
    ];
  },
};
