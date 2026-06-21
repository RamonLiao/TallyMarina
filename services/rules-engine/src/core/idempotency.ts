import { canonicalJson, sha256Hex } from './canonical.js';
import type { RuleInput } from '../domain/types.js';

// §7.8 lineage hash inputs；不適用欄位以顯式 null 參與序列化。
export function idempotencyKey(input: RuleInput, priorJeId: string | null): string {
  const ps = input.policySet;
  const lineage = {
    rawPayloadHash: input.event.rawPayloadHash,
    txDigest: input.event.txDigest,
    eventIndex: input.event.eventIndex,
    parserVersion: ps.parserVersion,
    normalizationVersion: ps.normalizationVersion,
    policySetVersion: ps.policySetVersion,
    assetPolicyVersion: ps.assetPolicyVersion,
    eventPolicyVersion: ps.eventPolicyVersion,
    ruleVersion: ps.ruleVersion,
    pricePointIds: input.prices.map((p) => p.id).sort(),
    fxRateIds: input.fxRates.map((f) => f.id).sort(),
    lotIds: input.lots.map((l) => l.lotId).sort(),
    approvalIds: [] as string[],   // slice 無 approval workflow；顯式空陣列
    priorJeId: priorJeId ?? null,
  };
  return sha256Hex(canonicalJson(lineage));
}
