import type { EventStrategy } from './registry.js';
import type { JeLine, DisclosureFact, RuleException } from '../domain/types.js';
import { subMinor, ltMinor, negMinor } from '../core/decimal.js';
import { balanceCheck } from './receiptRules.js';
import { paymentStrategy } from './paymentRules.js';

export const gasStrategy: EventStrategy = {
  ruleIds: ['gas-fee-expense-v1', 'gas-derecognition-v1'],
  requiresValuation: true,
  classify: () => null,
  buildLotPlan: paymentStrategy.buildLotPlan,
  buildMeasurements: paymentStrategy.buildMeasurements,
  buildJeLines: (ctx): JeLine[] | RuleException => {
    const { event, coaMapping } = ctx.input;
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    const gain = subMinor(fv, carrying);
    const feeAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: 'NETWORK_FEE', coinType: event.coinType });
    const assetAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: 'DISPOSAL', coinType: event.coinType });
    const gainAcct = coaMapping.resolve({ eventType: 'GAS_FEE', leg: ltMinor(gain, '0') ? 'DISPOSAL_LOSS' : 'DISPOSAL_GAIN', coinType: event.coinType });
    if (!feeAcct || !assetAcct || !gainAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: {} };
    const lines: JeLine[] = [
      { account: feeAcct, side: 'DEBIT', amountMinor: fv, origCoinType: null, origQtyMinor: null, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'NETWORK_FEE' },
      { account: assetAcct, side: 'CREDIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'DISPOSAL' },
    ];
    if (ltMinor(gain, '0')) {
      lines.push({ account: gainAcct, side: 'DEBIT', amountMinor: negMinor(gain), origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_LOSS' });
    } else {
      lines.push({ account: gainAcct, side: 'CREDIT', amountMinor: gain, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_GAIN' });
    }
    return balanceCheck(lines);
  },
  buildDisclosure: (ctx): DisclosureFact[] => [
    { kind: 'gas_fee', detail: { feeExpense: ctx.carry.fvFunctionalMinor, disposalGain: subMinor(ctx.carry.fvFunctionalMinor as string, ctx.carry.carryingMinor as string) } },
  ],
};
