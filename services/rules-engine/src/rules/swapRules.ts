import type { EventStrategy, LotPlan } from './registry.js';
import type { PipelineCtx } from '../pipeline/context.js';
import type { JeLine, Measurement, DisclosureFact, RuleException } from '../domain/types.js';
import { allocateFifo } from '../core/fifo.js';
import { subMinor, ltMinor, negMinor } from '../core/decimal.js';
import { balanceCheck } from './receiptRules.js';

export const swapStrategy: EventStrategy = {
  ruleIds: ['swap-disposal-acquisition-v1'],
  requiresValuation: true,
  classify: (ctx) => {
    const { event } = ctx.input;
    if (!event.considerationAsset || !event.considerationQtyMinor || event.considerationDecimals === null)
      return { phase: 5, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { reason: 'swap 需 considerationAsset/Qty/Decimals' } };
    ctx.carry.valuationCoinType = event.considerationAsset;
    ctx.carry.valuationQtyMinor = event.considerationQtyMinor;
    ctx.carry.valuationDecimals = event.considerationDecimals;
    return null;
  },
  buildLotPlan: (ctx): LotPlan | RuleException => {
    const { event } = ctx.input;
    const r = allocateFifo(ctx.input.lots, event.coinType, event.wallet, event.quantityMinor);
    if (!r.ok) return { phase: 7, code: 'INSUFFICIENT_LOT', detail: { available: r.availableQtyMinor } };
    ctx.carry.carryingMinor = r.totalCarryingMinor;
    const disposed = r.consumed.map((c) => ({
      lotId: c.lotId,
      coinType: event.coinType,
      wallet: event.wallet,
      deltaQtyMinor: negMinor(c.qtyMinor),
      deltaCostMinor: negMinor(c.costMinor),
    }));
    const fv = ctx.carry.fvFunctionalMinor as string;
    const acquired = {
      lotId: `R-${event.txDigest}-${event.eventIndex}`,
      coinType: event.considerationAsset!,
      wallet: event.wallet,
      deltaQtyMinor: event.considerationQtyMinor!,
      deltaCostMinor: fv,
    };
    return { movements: [...disposed, acquired], consumed: r.consumed };
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
    const acqAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: 'ACQUISITION', coinType: event.considerationAsset! });
    const dispAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: 'DISPOSAL', coinType: event.coinType });
    const gainAcct = coaMapping.resolve({ eventType: 'SPOT_TRADE_SWAP', leg: ltMinor(gain, '0') ? 'DISPOSAL_LOSS' : 'DISPOSAL_GAIN', coinType: event.coinType });
    if (!acqAcct || !dispAcct || !gainAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: {} };
    const lines: JeLine[] = [
      { account: acqAcct, side: 'DEBIT', amountMinor: fv, origCoinType: event.considerationAsset, origQtyMinor: event.considerationQtyMinor, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'ACQUISITION' },
      { account: dispAcct, side: 'CREDIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'DISPOSAL' },
    ];
    if (ltMinor(gain, '0')) {
      lines.push({ account: gainAcct, side: 'DEBIT', amountMinor: negMinor(gain), origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_LOSS' });
    } else {
      lines.push({ account: gainAcct, side: 'CREDIT', amountMinor: gain, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'DISPOSAL_GAIN' });
    }
    return balanceCheck(lines);
  },
  buildDisclosure: (ctx): DisclosureFact[] => {
    const fv = ctx.carry.fvFunctionalMinor as string;
    const carrying = ctx.carry.carryingMinor as string;
    return [{ kind: 'swap', detail: { acquiredCost: fv, disposedCost: carrying, gain: subMinor(fv, carrying) } }];
  },
};
