import type { Phase } from '../context.js';

export const phaseMapping: Phase = (ctx) => {
  const { coaMapping, event } = ctx.input;
  const assetAccount = coaMapping.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'ACQUISITION', coinType: event.coinType });
  const arAccount = coaMapping.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'RECEIVABLE_SETTLEMENT', coinType: event.coinType });
  if (!assetAccount || !arAccount) {
    return { phase: 9, code: 'MAPPING_MISSING', detail: { assetAccount, arAccount } };
  }
  ctx.carry.assetAccount = assetAccount;
  ctx.carry.arAccount = arAccount;
  return null;
};
