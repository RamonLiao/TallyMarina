import { Transaction } from '@mysten/sui/transactions';
import { buildAnchorArgs, type AnchorPayloadInput } from './buildAnchorArgs.js';

const MODULE = 'audit_anchor';
const ANCHOR_FN = 'anchor_snapshot';

export interface BuildAnchorPtbInput {
  packageId: string;
  chainObjectId: string;
  capObjectId: string;
  prevLink: Uint8Array;
  walletAddress: string;
  args: AnchorPayloadInput;
}

export interface AnchorPtb {
  txKind: string; // tx.serialize() JSON IR — NOT built BCS bytes
  capId: string;
}

/**
 * Build the unsigned anchor Transaction IR. The WALLET resolves gas + owned-object
 * versions at sign time, so we deliberately do NOT setGasPayment, do NOT pin versions,
 * and do NOT tx.build(). Pinning here freezes the AnchorCap version → -32002 stale-version
 * abort on back-to-back anchors (see spec §5).
 */
export function buildAnchorPtb(input: BuildAnchorPtbInput): AnchorPtb {
  const args = buildAnchorArgs(input.args); // validates hashes/period/seq (fail-closed)
  const tx = new Transaction();
  tx.moveCall({
    target: `${input.packageId}::${MODULE}::${ANCHOR_FN}`,
    arguments: [
      tx.object(input.chainObjectId),
      tx.object(input.capObjectId),
      tx.pure.vector('u8', Array.from(args.manifestHash)),
      tx.pure.vector('u8', Array.from(args.merkleRoot)),
      tx.pure.vector('u8', Array.from(args.periodId)),
      tx.pure.vector('u8', Array.from(input.prevLink)),
      tx.pure.u64(args.supersedesSeq),
    ],
  });
  tx.setSender(input.walletAddress);
  return { txKind: tx.serialize(), capId: input.capObjectId };
}
