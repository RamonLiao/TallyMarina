import { z } from 'zod';

export const eventTypeSchema = z.enum([
  'DIGITAL_ASSET_RECEIPT', 'DIGITAL_ASSET_PAYMENT',
  'INTERNAL_TRANSFER', 'SPOT_TRADE_SWAP', 'GAS_FEE',
]);

// 事件數量為非負 minor-unit；方向由 event type / leg 表達，不以負數承載。
const qtyMinorStr = z.string().regex(/^\d+$/, 'non-negative minor-unit integer string');

export const normalizedEventSchema = z.object({
  schemaVersion: z.string().min(1),
  eventId: z.string().min(1),
  eventType: eventTypeSchema,
  eventGroupId: z.string().nullable(),
  entityId: z.string().min(1),
  bookId: z.string().min(1),
  wallet: z.string().min(1),
  counterparty: z.string().nullable(),
  coinType: z.string().min(1),
  assetDecimals: z.number().int().min(0).max(36),   // bound 指數，防 10^n BigInt DoS
  quantityMinor: qtyMinorStr,
  eventTime: z.string().min(1),
  economicPurpose: z.string().min(1),
  ownershipChange: z.boolean(),
  considerationAsset: z.string().nullable(),
  considerationQtyMinor: qtyMinorStr.nullable(),
  considerationDecimals: z.number().int().min(0).max(36).nullable(),
  rawPayloadHash: z.string().min(1),
  txDigest: z.string().min(1),
  eventIndex: z.number().int().min(0),
});

export const runContextSchema = z.object({
  runId: z.string().min(1),
  entityId: z.string().min(1),
  bookId: z.string().min(1),
  periodId: z.string().min(1),
  mode: z.enum(['PREVIEW', 'POST', 'REPLAY']),
  asOf: z.string().min(1),
});
