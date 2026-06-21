import type { EventStrategy, LotPlan } from './registry.js';
import type { PipelineCtx } from '../pipeline/context.js';
import type { JeLine, Measurement, DisclosureFact, RuleException } from '../domain/types.js';
import { negMinor } from '../core/decimal.js';
import { allocateFifo } from '../core/fifo.js';
import { balanceCheck } from './receiptRules.js';

export const internalTransferStrategy: EventStrategy = {
  ruleIds: ['internal-transfer-continuity-v1'],
  requiresValuation: false,
  classify: (ctx) => ctx.input.event.counterparty ? null : { phase: 2, code: 'ENTITY_BOUNDARY', detail: { reason: 'transfer 需 destination wallet (counterparty)' } },
  buildLotPlan: (ctx): LotPlan | RuleException => {
    const { event } = ctx.input;
    const dest = event.counterparty!;
    const r = allocateFifo(ctx.input.lots, event.coinType, event.wallet, event.quantityMinor);
    if (!r.ok) return { phase: 7, code: 'INSUFFICIENT_LOT', detail: { available: r.availableQtyMinor } };
    ctx.carry.carryingMinor = r.totalCarryingMinor;
    const moves = r.consumed.flatMap((c) => ([
      { lotId: c.lotId, coinType: event.coinType, wallet: event.wallet, deltaQtyMinor: negMinor(c.qtyMinor), deltaCostMinor: negMinor(c.costMinor) },
      { lotId: `${c.lotId}@${dest}`, coinType: event.coinType, wallet: dest, deltaQtyMinor: c.qtyMinor, deltaCostMinor: c.costMinor },
    ]));
    return { movements: moves, consumed: r.consumed };
  },
  buildMeasurements: (ctx): Measurement[] => [{ name: 'disposal_carrying', amountMinor: ctx.carry.carryingMinor as string, currency: ctx.input.policySet.functionalCurrency, track: 'CARRYING' }],
  buildJeLines: (ctx): JeLine[] | RuleException => {
    const { event, coaMapping } = ctx.input;
    const carrying = ctx.carry.carryingMinor as string;
    const dest = event.counterparty!;
    const srcAcct = coaMapping.resolve({ eventType: 'INTERNAL_TRANSFER', leg: `WALLET:${event.wallet}`, coinType: event.coinType });
    const dstAcct = coaMapping.resolve({ eventType: 'INTERNAL_TRANSFER', leg: `WALLET:${dest}`, coinType: event.coinType });
    if (!srcAcct || !dstAcct) return { phase: 9, code: 'MAPPING_MISSING', detail: { srcAcct, dstAcct } };
    if (srcAcct === dstAcct) return [];
    return balanceCheck([
      { account: dstAcct, side: 'DEBIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'TRANSFER_IN' },
      { account: srcAcct, side: 'CREDIT', amountMinor: carrying, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'TRANSFER_OUT' },
    ]);
  },
  buildDisclosure: (): DisclosureFact[] => [{ kind: 'internal_transfer', detail: { gainLoss: '0' } }],
};
