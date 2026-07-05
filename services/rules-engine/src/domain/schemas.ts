import { z } from 'zod';

export const eventTypeSchema = z.enum([
  'DIGITAL_ASSET_RECEIPT', 'DIGITAL_ASSET_PAYMENT',
  'INTERNAL_TRANSFER', 'SPOT_TRADE_SWAP', 'GAS_FEE', 'OPENING_LOT',
]);

// 事件數量為正整數 minor-unit；零量無意義且產生空 JE，fail-closed 在此擋下。
const qtyMinorStr = z.string().regex(/^[1-9]\d*$/, 'positive minor-unit integer string (≥1)');

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
  openingCostMinor: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
}).superRefine((event, ctx) => {
  // OPENING_LOT fail-closed (spec §3): historical cost must be present (zero allowed,
  // e.g. airdrop/fork lots with zero historical basis); quantityMinor already gated
  // strictly positive by qtyMinorStr above.
  if (event.eventType === 'OPENING_LOT') {
    if (!event.openingCostMinor || !/^(0|[1-9][0-9]*)$/.test(event.openingCostMinor)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['openingCostMinor'], message: 'OPENING_LOT requires an openingCostMinor (non-negative minor-unit integer string)' });
    }
  }
});

export const runContextSchema = z.object({
  runId: z.string().min(1),
  entityId: z.string().min(1),
  bookId: z.string().min(1),
  periodId: z.string().min(1),
  mode: z.enum(['PREVIEW', 'POST', 'REPLAY']),
  asOf: z.string().min(1),
});
