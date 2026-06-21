import { bcs } from '@mysten/bcs';
import type { JournalEntry, JeLine } from '../domain/types.js';

export const JE_LEAF_CODEC_VERSION = 'JE_LEAF_BCS_V1';

// FROZEN schema — field order/types must not change without bumping the version + golden vectors.
const JeLineBcs = bcs.struct('JeLineBcs', {
  account: bcs.string(),
  side: bcs.u8(),                       // DEBIT = 0, CREDIT = 1
  amountMinor: bcs.string(),            // minor-unit integer string (NOT numeric)
  origCoinType: bcs.option(bcs.string()),
  origQtyMinor: bcs.option(bcs.string()),
  priceRef: bcs.option(bcs.string()),
  fxRef: bcs.option(bcs.string()),
  leg: bcs.string(),
});

const JournalEntryLeaf = bcs.struct('JournalEntryLeaf', {
  idempotencyKey: bcs.string(),
  reversalOf: bcs.option(bcs.string()),
  lines: bcs.vector(JeLineBcs),
});

function sideToU8(side: JeLine['side']): number {
  return side === 'DEBIT' ? 0 : 1;       // exhaustive: JeLine.side is 'DEBIT' | 'CREDIT'
}

export function encodeJeLeaf(je: JournalEntry): Uint8Array {
  return JournalEntryLeaf.serialize({
    idempotencyKey: je.idempotencyKey,
    reversalOf: je.reversalOf,
    lines: je.lines.map((l) => ({
      account: l.account,
      side: sideToU8(l.side),
      amountMinor: l.amountMinor,
      origCoinType: l.origCoinType,
      origQtyMinor: l.origQtyMinor,
      priceRef: l.priceRef,
      fxRef: l.fxRef,
      leg: l.leg,
    })),
  }).toBytes();
}
