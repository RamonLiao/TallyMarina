// DATA ZONE (spec §8.4) — NEVER import Mascot here.
// Byte-identical mirror of services/rules-engine/src/core/leafCodec.ts (JE_LEAF_BCS_V1)
// + the leaf hashing in services/rules-engine/src/core/merkle.ts:
//   leaf = SHA-256(0x00 || BCS(JournalEntryLeaf))
// Pinned by leafEncode.test.ts against real backend leafHash values (merge gate).
import { bcs } from '@mysten/sui/bcs';
import type { JournalEntryBody, JournalLine } from '../api/types';

const LEAF_PREFIX = 0x00;

const JeLineBcs = bcs.struct('JeLineBcs', {
  account: bcs.string(),
  side: bcs.u8(),                       // DEBIT = 0, CREDIT = 1
  amountMinor: bcs.string(),
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

function sideToU8(side: JournalLine['side']): number {
  if (side === 'DEBIT') return 0;
  if (side === 'CREDIT') return 1;
  throw new Error(`leafEncode: invalid side ${String(side)}`);
}

export function encodeJeLeaf(je: JournalEntryBody): Uint8Array {
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
      leg: String(l.leg), // JournalLine.leg is typed `unknown` in the web DTO; it is a string at runtime
    })),
  }).toBytes();
}

export async function leafHash(je: JournalEntryBody): Promise<string> {
  const body = encodeJeLeaf(je);
  const prefixed = new Uint8Array(1 + body.length);
  prefixed[0] = LEAF_PREFIX;
  prefixed.set(body, 1);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', prefixed.buffer as ArrayBuffer));
  return [...digest].map((x) => x.toString(16).padStart(2, '0')).join('');
}
