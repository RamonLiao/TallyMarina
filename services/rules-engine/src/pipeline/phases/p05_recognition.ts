import type { Phase } from '../context.js';

export const phaseRecognition: Phase = (ctx) => {
  // receipt：有對價清償 AR / 無對價認列收入。slice 以 economicPurpose 判定，皆認列。
  void ctx;
  ctx.carry.recognize = true;
  return null;
};
