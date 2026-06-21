import type { Phase } from '../context.js';
import { getStrategy, STRATEGIES } from '../../rules/registry.js';

export const phaseClassification: Phase = (ctx) => {
  const t = ctx.input.event.eventType;
  if (!STRATEGIES[t]) return { phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { eventType: t } };
  const ex = getStrategy(t).classify(ctx);
  if (ex) return ex;
  ctx.carry.eventType = t;
  return null;
};
