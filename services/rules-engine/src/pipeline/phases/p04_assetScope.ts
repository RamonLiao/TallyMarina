import type { Phase } from '../context.js';

export const phaseAssetScope: Phase = (ctx) => {
  const a = ctx.input.assetAssessment;
  if (a.coinType !== ctx.input.event.coinType || a.status !== 'APPROVED') {
    return { phase: 4, code: 'SCOPE_UNKNOWN', detail: { coinType: ctx.input.event.coinType, status: a.status } };
  }
  ctx.carry.assessment = a;
  return null;
};
