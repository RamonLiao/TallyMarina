import type { EventStrategy, LotPlan } from './registry.js';
import type { JeLine, Measurement, DisclosureFact, RuleException } from '../domain/types.js';

// OPENING_LOT (spec §3): originates a pre-history lot. Emits one positive movement and
// NO journal entry — the opening-equity JE is an explicit deferral (spec §7, evidence gap).
// The JE-less POSTABLE path is the same §7.8.3 branch used by same-wallet ITX.
export const openingLotStrategy: EventStrategy = {
  ruleIds: ['opening-lot-origination-v1'],
  requiresValuation: false, // historical cost comes from the event payload, never repriced
  classify: () => null,
  buildLotPlan: (ctx): LotPlan | RuleException => {
    const { event } = ctx.input;
    const cost = event.openingCostMinor;
    if (!cost) return { phase: 7, code: 'SCHEMA_INVALID', detail: 'OPENING_LOT requires openingCostMinor' };
    return {
      movements: [{
        lotId: `OPEN-${event.eventId}`, coinType: event.coinType, wallet: event.wallet,
        deltaQtyMinor: event.quantityMinor, deltaCostMinor: cost,
      }],
      consumed: [],
    };
  },
  buildMeasurements: (): Measurement[] => [],
  buildJeLines: (): JeLine[] | RuleException => [], // no JE — engine emits journalEntries: []
  buildDisclosure: (ctx): DisclosureFact[] =>
    [{ kind: 'opening_lot', detail: { units: ctx.input.event.quantityMinor, cost: ctx.input.event.openingCostMinor } }],
};
