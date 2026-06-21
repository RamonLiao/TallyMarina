import type { Phase } from '../context.js';

export const phaseOwnership: Phase = (ctx) => {
  const { event, runContext } = ctx.input;
  if (event.entityId !== runContext.entityId) {
    return { phase: 2, code: 'ENTITY_BOUNDARY', detail: { event: event.entityId, run: runContext.entityId } };
  }
  return null;
};
