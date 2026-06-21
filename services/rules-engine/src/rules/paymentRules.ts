import type { EventStrategy, LotPlan } from './registry.js';
import type { PipelineCtx } from '../pipeline/context.js';
import type { JeLine, Measurement, DisclosureFact, RuleException, LotMovement } from '../domain/types.js';
import { allocateFifo, type ConsumedLot } from '../core/fifo.js';
import { subMinor, ltMinor, negMinor, isZeroMinor } from '../core/decimal.js';
import { balanceCheck } from './receiptRules.js';

interface FifoOk { consumed: ConsumedLot[]; movements: LotMovement[]; carrying: string }

function fifoOrEx(ctx: PipelineCtx): FifoOk | RuleException {
  const { event } = ctx.input;
  const r = allocateFifo(ctx.input.lots, event.coinType, event.wallet, event.quantityMinor);
  if (!r.ok) return { phase: 7, code: 'INSUFFICIENT_LOT', detail: { available: r.availableQtyMinor, needed: event.quantityMinor } };
  const movements: LotMovement[] = r.consumed.map((c) => ({
    lotId: c.lotId,
    coinType: event.coinType,
    wallet: event.wallet,
    deltaQtyMinor: negMinor(c.qtyMinor),
    deltaCostMinor: negMinor(c.costMinor),
  }));
  return { consumed: r.consumed, movements, carrying: r.totalCarryingMinor };
}

export const paymentStrategy: EventStrategy = {
  ruleIds: ['payment-derecognition-v1', 'payment-je-disposal-v1'],
  requiresValuation: true,
  classify: () => null,
  buildLotPlan: (ctx): LotPlan | RuleException => {
    const r = fifoOrEx(ctx);
    if ('code' in r) return r;
    ctx.carry.carryingMinor = r.carrying;
    return { movements: r.movements, consumed: r.consumed };
  },
  buildMeasurements: (ctx): Measurement[] => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    const cur = ctx.input.policySet.functionalCurrency;
    return [
      { name: 'consideration_fv', amountMinor: fv, currency: cur, track: 'FV' },
      { name: 'disposal_carrying', amountMinor: carrying, currency: cur, track: 'CARRYING' },
      { name: 'realized_gain', amountMinor: subMinor(fv, carrying), currency: cur, track: 'GAIN' },
    ];
  },
  buildJeLines: (ctx): JeLine[] | RuleException => {
    const { event, coaMapping } = ctx.input;
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    const gain = subMinor(fv, carrying);
    const expenseAcct = coaMapping.resolve({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'EXPENSE', coinType: event.coinType });
    const assetAcct = coaMapping.resolve({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'DISPOSAL', coinType: event.coinType });
    if (!expenseAcct || !assetAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: { expenseAcct, assetAcct } };
    const lines: JeLine[] = [
      { account: expenseAcct, side: 'DEBIT', amountMinor: fv, origCoinType: null, origQtyMinor: null, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'EXPENSE' },
      { account: assetAcct, side: 'CREDIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'DISPOSAL' },
    ];
    if (!isZeroMinor(gain)) {
      const gainLeg = ltMinor(gain, '0') ? 'DISPOSAL_LOSS' : 'DISPOSAL_GAIN';
      const gainAcct = coaMapping.resolve({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: gainLeg, coinType: event.coinType });
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
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    return [{ kind: 'disposal', detail: { proceeds: fv, cost: carrying, gain: subMinor(fv, carrying) } }];
  },
};
