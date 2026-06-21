import type { Phase } from '../context.js';
import type { JeLine } from '../../domain/types.js';
import { sumMinor, negMinor, isZeroMinor } from '../../core/decimal.js';

export const phaseJe: Phase = (ctx) => {
  const fv = ctx.carry.fvFunctionalMinor as string;
  const assetAccount = ctx.carry.assetAccount as string;
  const arAccount = ctx.carry.arAccount as string;
  const { event } = ctx.input;
  const lines: JeLine[] = [
    { account: assetAccount, side: 'DEBIT', amountMinor: fv, origCoinType: event.coinType,
      origQtyMinor: event.quantityMinor, priceRef: ctx.carry.priceRef as string, fxRef: ctx.carry.fxRef as string, leg: 'ACQUISITION' },
    { account: arAccount, side: 'CREDIT', amountMinor: fv, origCoinType: null,
      origQtyMinor: null, priceRef: null, fxRef: null, leg: 'RECEIVABLE_SETTLEMENT' },
  ];
  const debit = sumMinor(lines.filter((l) => l.side === 'DEBIT').map((l) => l.amountMinor));
  const credit = sumMinor(lines.filter((l) => l.side === 'CREDIT').map((l) => l.amountMinor));
  if (!isZeroMinor(sumMinor([debit, negMinor(credit)]))) {
    return { phase: 10, code: 'JE_OUT_OF_BALANCE', detail: { debit, credit } };
  }
  ctx.carry.journalLines = lines;
  return null;
};
