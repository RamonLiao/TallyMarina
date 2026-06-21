import type { Phase } from '../context.js';
import type { RuleException } from '../../domain/types.js';
import { getStrategy } from '../../rules/registry.js';

export const phaseJe: Phase = (ctx) => {
  const r = getStrategy(ctx.input.event.eventType).buildJeLines(ctx);
  if ('code' in r) return r as RuleException;
  ctx.carry.journalLines = r;
  return null;
};
