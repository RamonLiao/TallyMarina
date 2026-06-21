import type { Phase } from '../context.js';

export const phaseClassification: Phase = (ctx) => {
  const t = ctx.input.event.eventType;
  if (t !== 'DIGITAL_ASSET_RECEIPT') {
    return { phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { eventType: t } };
  }
  ctx.carry.eventType = t;
  return null;
};
