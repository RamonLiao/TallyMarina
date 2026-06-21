import type { EventStrategy, LotPlan } from './registry.js';
import type { PipelineCtx } from '../pipeline/context.js';
import type { JeLine, Measurement, DisclosureFact, RuleException } from '../domain/types.js';
import { sumMinor, negMinor, isZeroMinor } from '../core/decimal.js';

export const receiptStrategy: EventStrategy = {
  ruleIds: ['receipt-recognition-v1', 'receipt-je-ar-settlement-v1'],
  requiresValuation: true,
  classify: (ctx) => {
    // §3.1：本 slice 只 RECEIVABLE_SETTLEMENT；其餘 purpose 交 review
    const p = ctx.input.event.economicPurpose;
    if (p !== 'RECEIVABLE_SETTLEMENT') return { phase: 5, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { economicPurpose: p } };
    return null;
  },
  buildLotPlan: (ctx): LotPlan => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    const { event } = ctx.input;
    return {
      movements: [{ lotId: `R-${event.txDigest}-${event.eventIndex}`, coinType: event.coinType, wallet: event.wallet, deltaQtyMinor: event.quantityMinor, deltaCostMinor: fv }],
      consumed: [],
    };
  },
  buildMeasurements: (ctx): Measurement[] => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    return [{ name: 'consideration_fv', amountMinor: fv, currency: ctx.input.policySet.functionalCurrency, track: 'FV' }];
  },
  buildJeLines: (ctx): JeLine[] | RuleException => {
    const assetAccount = ctx.input.coaMapping.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'ACQUISITION', coinType: ctx.input.event.coinType });
    const arAccount = ctx.input.coaMapping.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'RECEIVABLE_SETTLEMENT', coinType: ctx.input.event.coinType });
    if (!assetAccount || !arAccount) return { phase: 9, code: 'MAPPING_MISSING', detail: { assetAccount, arAccount } };
    const fv = ctx.carry.fvFunctionalMinor as string;
    const { event } = ctx.input;
    const lines: JeLine[] = [
      { account: assetAccount, side: 'DEBIT', amountMinor: fv, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'ACQUISITION' },
      { account: arAccount, side: 'CREDIT', amountMinor: fv, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'RECEIVABLE_SETTLEMENT' },
    ];
    return balanceCheck(lines);
  },
  buildDisclosure: (ctx): DisclosureFact[] => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    return [{ kind: 'acquisition', detail: { units: ctx.input.event.quantityMinor, cost: fv, nonCashSettlement: true } }];
  },
};

export function balanceCheck(lines: JeLine[]): JeLine[] | RuleException {
  const debit = sumMinor(lines.filter((l) => l.side === 'DEBIT').map((l) => l.amountMinor));
  const credit = sumMinor(lines.filter((l) => l.side === 'CREDIT').map((l) => l.amountMinor));
  if (!isZeroMinor(sumMinor([debit, negMinor(credit)]))) return { phase: 10, code: 'JE_OUT_OF_BALANCE', detail: { debit, credit } };
  return lines;
}
