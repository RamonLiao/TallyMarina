import type { Phase } from '../context.js';
import { getStrategy } from '../../rules/registry.js';

export const phaseMeasure: Phase = (ctx) => {
  ctx.carry.measurements = getStrategy(ctx.input.event.eventType).buildMeasurements(ctx);
  return null;
};
