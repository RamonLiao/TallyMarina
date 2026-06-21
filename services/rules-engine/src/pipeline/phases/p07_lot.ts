import type { Phase } from '../context.js';
import type { LotMovement } from '../../domain/types.js';

export const phaseLot: Phase = (ctx) => {
  // receipt：建 acquisition lot，永不消耗既有 lot（不跑 FIFO）。
  const fv = ctx.carry.fvFunctionalMinor as string;
  const { event } = ctx.input;
  const mv: LotMovement = {
    lotId: `R-${event.txDigest}-${event.eventIndex}`,
    coinType: event.coinType,
    wallet: event.wallet,
    deltaQtyMinor: event.quantityMinor,   // 正：acquire
    deltaCostMinor: fv,
  };
  ctx.carry.lotMovements = [mv];
  return null;
};
