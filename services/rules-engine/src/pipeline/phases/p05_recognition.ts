import type { Phase } from '../context.js';

// §3.1 receipt 有兩條路徑：清償 AR / 無對價收入。
// 本 slice 只實作 RECEIVABLE_SETTLEMENT；其餘 purpose 明確交 review，不可 silent 記成 AR（§12 fail-loud）。
export const phaseRecognition: Phase = (ctx) => {
  const purpose = ctx.input.event.economicPurpose;
  if (purpose !== 'RECEIVABLE_SETTLEMENT') {
    return { phase: 5, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { economicPurpose: purpose, supported: ['RECEIVABLE_SETTLEMENT'] } };
  }
  ctx.carry.recognize = true;
  return null;
};
