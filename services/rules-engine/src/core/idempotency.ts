import { canonicalJson, sha256Hex } from './canonical.js';
import type { RuleInput } from '../domain/types.js';

// 穩定 key：只取 event identity + policy versions。刻意不含 price/fx/lot（→ lineageHash）。
export function idempotencyKey(input: RuleInput, priorJeId: string | null): string {
  const ps = input.policySet;
  const lineage = {
    entityId: input.event.entityId,
    bookId: input.event.bookId,
    rawPayloadHash: input.event.rawPayloadHash,
    txDigest: input.event.txDigest,
    eventIndex: input.event.eventIndex,
    parserVersion: ps.parserVersion,
    normalizationVersion: ps.normalizationVersion,
    policySetVersion: ps.policySetVersion,
    assetPolicyVersion: ps.assetPolicyVersion,
    eventPolicyVersion: ps.eventPolicyVersion,
    ruleVersion: ps.ruleVersion,
    priorJeId: priorJeId ?? null,
  };
  return sha256Hex(canonicalJson(lineage));
}

// resolved refs 審計用 sidecar；進 JournalEntry.lineageHash，不進 merkle leaf。
export function lineageHash(args: {
  priceRefs: string[]; fxRefs: string[]; consumedLots: { lotId: string; qtyMinor: string; costMinor: string }[]; approvalIds: string[];
}): string {
  return sha256Hex(canonicalJson({
    priceRefs: [...args.priceRefs].sort(),
    fxRefs: [...args.fxRefs].sort(),
    consumedLots: [...args.consumedLots].sort((a, b) => a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : a.qtyMinor < b.qtyMinor ? -1 : 1),
    approvalIds: [...args.approvalIds].sort(),
  }));
}
