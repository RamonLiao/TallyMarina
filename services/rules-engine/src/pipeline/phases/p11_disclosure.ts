import type { Phase } from '../context.js';
import type { DisclosureFact } from '../../domain/types.js';

export const phaseDisclosure: Phase = (ctx) => {
  const fv = ctx.carry.fvFunctionalMinor as string;
  const { event } = ctx.input;
  const facts: DisclosureFact[] = [
    { kind: 'acquisition', detail: { units: event.quantityMinor, cost: fv, nonCashSettlement: true } },
  ];
  ctx.carry.disclosureFacts = facts;
  return null;
};
