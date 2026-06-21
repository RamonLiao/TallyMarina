import { z } from 'zod';

export const eventTypeSchema = z.enum([
  'DIGITAL_ASSET_RECEIPT', 'DIGITAL_ASSET_PAYMENT',
  'INTERNAL_TRANSFER', 'SPOT_TRADE_SWAP', 'GAS_FEE',
]);

const minorStr = z.string().regex(/^-?\d+$/, 'minor-unit integer string');

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
  assetDecimals: z.number().int().min(0),
  quantityMinor: minorStr,
  eventTime: z.string().min(1),
  economicPurpose: z.string().min(1),
  ownershipChange: z.boolean(),
  considerationAsset: z.string().nullable(),
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
