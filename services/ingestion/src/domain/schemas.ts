import { z } from 'zod';

const numericString = z.string().regex(/^\d+$/, 'must be a non-negative integer string');

export const rawTxEnvelopeSchema = z.object({
  digest: z.string().min(1),
  checkpoint: numericString,
  timestampMs: numericString,
  status: z.enum(['success', 'failure']),
  rawJson: z.unknown(),
});

export const rawEffectSchema = z.object({
  rawIndex: z.number().int().nonnegative(),
  kind: z.enum(['coin_balance_change', 'object_transfer', 'gas', 'staking', 'event', 'unknown']),
  coinType: z.string().optional(),
  amount: z.string().regex(/^-?\d+$/).optional(),  // signed minor-unit integer
  decimals: z.number().int().optional(),
  counterparty: z.string().optional(),
  objectId: z.string().optional(),
  rawRef: z.string().optional(),
});
