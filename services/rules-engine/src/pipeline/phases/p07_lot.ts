import type { Phase } from '../context.js';
import { getStrategy } from '../../rules/registry.js';

export const phaseLot: Phase = (ctx) => {
  const r = getStrategy(ctx.input.event.eventType).buildLotPlan(ctx);
  if ('code' in r) return r;
  ctx.carry.lotMovements = r.movements;
  ctx.carry.consumedLots = r.consumed;
  return null;
};
