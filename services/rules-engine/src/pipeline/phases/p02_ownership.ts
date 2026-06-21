import type { Phase } from '../context.js';

export const phaseOwnership: Phase = (ctx) => {
  const { event, runContext } = ctx.input;
  if (event.entityId !== runContext.entityId) {
    return { phase: 2, code: 'ENTITY_BOUNDARY', detail: { field: 'entityId', event: event.entityId, run: runContext.entityId } };
  }
  if (event.bookId !== runContext.bookId) {
    return { phase: 2, code: 'ENTITY_BOUNDARY', detail: { field: 'bookId', event: event.bookId, run: runContext.bookId } };
  }
  return null;
};
