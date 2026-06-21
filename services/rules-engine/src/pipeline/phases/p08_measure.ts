import type { Phase } from '../context.js';

export const phaseMeasure: Phase = (ctx) => {
  const fv = ctx.carry.fvFunctionalMinor as string;
  ctx.carry.measurements = [
    { name: 'consideration_fv', amountMinor: fv, currency: ctx.input.policySet.functionalCurrency },
  ];
  return null;
};
