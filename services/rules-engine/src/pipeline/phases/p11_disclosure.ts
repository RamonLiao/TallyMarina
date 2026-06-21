import type { Phase } from '../context.js';
import { getStrategy } from '../../rules/registry.js';

export const phaseDisclosure: Phase = (ctx) => {
  ctx.carry.disclosureFacts = getStrategy(ctx.input.event.eventType).buildDisclosure(ctx);
  return null;
};
