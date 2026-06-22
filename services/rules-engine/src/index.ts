import type { RuleInput, RuleOutput, RuleException, JournalEntry, JeLine, LotMovement, DisclosureFact } from './domain/types.js';
import { negMinor } from './core/decimal.js';
import { runPipeline } from './pipeline/runPipeline.js';
import { phaseSchema } from './pipeline/phases/p01_schema.js';
import { phaseOwnership } from './pipeline/phases/p02_ownership.js';
import { phaseClassification } from './pipeline/phases/p03_classification.js';
import { phaseAssetScope } from './pipeline/phases/p04_assetScope.js';
import { phaseRecognition } from './pipeline/phases/p05_recognition.js';
import { phasePriceFx } from './pipeline/phases/p06_pricefx.js';
import { phaseLot } from './pipeline/phases/p07_lot.js';
import { phaseMeasure } from './pipeline/phases/p08_measure.js';
import { phaseMapping } from './pipeline/phases/p09_mapping.js';
import { phaseJe } from './pipeline/phases/p10_je.js';
import { phaseDisclosure } from './pipeline/phases/p11_disclosure.js';
import { idempotencyKey, lineageHash } from './core/idempotency.js';
import { getStrategy, STRATEGIES } from './rules/registry.js';

const PHASES = [
  phaseSchema, phaseOwnership, phaseClassification, phaseAssetScope, phaseRecognition,
  phasePriceFx, phaseLot, phaseMeasure, phaseMapping, phaseJe, phaseDisclosure,
];

function emptyExplanation() { return { ruleIds: [], policyVersions: [], priceRefs: [], fxRefs: [] }; }

function rejectOutput(ex: RuleException, input: RuleInput): RuleOutput {
  const decision = ex.code === 'NOT_IMPLEMENTED_IN_SLICE' || ex.code === 'SCOPE_UNKNOWN'
    ? 'REVIEW_REQUIRED' : 'REJECTED';
  return {
    decision,
    assessment: { eventType: input.event.eventType, accountingClass: input.assetAssessment.accountingClass, measurementModel: input.assetAssessment.measurementModel },
    measurements: [], lotMovements: [], journalEntries: [], disclosureFacts: [],
    exceptions: [ex], explanation: emptyExplanation(),
  };
}

// 接受 unknown：catch block 內絕不可因 input 本身為 null/畸形而再次 throw。
function safeAssessment(input: unknown) {
  const i = (input ?? {}) as Partial<RuleInput>;
  return {
    eventType: i.event?.eventType ?? ('DIGITAL_ASSET_RECEIPT' as RuleInput['event']['eventType']),
    accountingClass: i.assetAssessment?.accountingClass ?? '',
    measurementModel: i.assetAssessment?.measurementModel ?? '',
  };
}

export function evaluate(input: RuleInput): RuleOutput {
  // INPUT_ERROR 是「系統級 fail-closed guard」，刻意有別於 §6.5 的業務 exception codes：
  // 任何未受控的 throw（畸形 input、scale 超界、非整除 FV 等）一律收斂為 REJECTED，不得讓服務崩潰。
  // B 任務強化：把可預期的精度/估值錯誤在其 phase（如 phase 6）明確化為業務碼，僅未知錯誤留給此 guard。
  try {
    return evaluateInner(input);
  } catch (e) {
    return {
      decision: 'REJECTED',
      assessment: safeAssessment(input),
      measurements: [], lotMovements: [], journalEntries: [], disclosureFacts: [],
      exceptions: [{ phase: 0, code: 'INPUT_ERROR', detail: { message: e instanceof Error ? e.message : String(e) } }],
      explanation: emptyExplanation(),
    };
  }
}

function evaluateInner(input: RuleInput): RuleOutput {
  // Period close gate（§6.6）
  if (!input.policySet.periodOpen && input.runContext.mode !== 'REPLAY') {
    return rejectOutput({ phase: 0, code: 'PERIOD_CLOSED', detail: { periodId: input.runContext.periodId } }, input);
  }

  if (!STRATEGIES[input.event.eventType]) {
    return rejectOutput({ phase: 3, code: 'NOT_IMPLEMENTED_IN_SLICE', detail: { eventType: input.event.eventType } }, input);
  }

  const key = idempotencyKey(input, null);

  // Replay：已 posted 回原 JE（idempotent）
  if (input.runContext.mode === 'REPLAY' && input.priorJournalEntries?.[key]) {
    return {
      decision: 'POSTABLE',
      assessment: { eventType: input.event.eventType, accountingClass: input.assetAssessment.accountingClass, measurementModel: input.assetAssessment.measurementModel },
      measurements: [], lotMovements: [], journalEntries: [input.priorJournalEntries[key]!],
      disclosureFacts: [], exceptions: [{ phase: 0, code: 'IDEMPOTENT_REPLAY', detail: { key } }],
      explanation: { ...emptyExplanation(), ruleIds: getStrategy(input.event.eventType).ruleIds },
    };
  }

  const { exception, carry } = runPipeline(input, PHASES);
  if (exception) return rejectOutput(exception, input);

  const journalLines = carry.journalLines as JeLine[];
  // §7.8.3: zero-value subledger movement (e.g. same-wallet ITX) emits NO JournalEntry — only lot location move.
  // Normal events always produce ≥2 balanced lines, so this branch is unreachable for them.
  const journalEntries: JournalEntry[] = journalLines.length === 0 ? [] : (() => {
    const lh = lineageHash({
      priceRefs: carry.priceRef ? [carry.priceRef as string] : [],
      fxRefs: carry.fxRef ? [carry.fxRef as string] : [],
      consumedLots: (carry.consumedLots as { lotId: string; qtyMinor: string; costMinor: string }[]) ?? [],
      approvalIds: [],
    });
    return [{ idempotencyKey: key, lineageHash: lh, lines: journalLines, reversalOf: null }];
  })();
  return {
    decision: 'POSTABLE',
    assessment: { eventType: input.event.eventType, accountingClass: input.assetAssessment.accountingClass, measurementModel: input.assetAssessment.measurementModel },
    measurements: carry.measurements as RuleOutput['measurements'],
    lotMovements: carry.lotMovements as LotMovement[],
    journalEntries,
    disclosureFacts: carry.disclosureFacts as DisclosureFact[],
    exceptions: [],
    explanation: {
      ruleIds: getStrategy(input.event.eventType).ruleIds,
      policyVersions: [input.policySet.policySetVersion, input.policySet.ruleVersion],
      priceRefs: carry.priceRef ? [carry.priceRef as string] : [],
      fxRefs: carry.fxRef ? [carry.fxRef as string] : [],
    },
  };
}

// 沖銷：產反向 JE + negated lot movements，lineage 指回 prior（§6.6）。金額皆正，僅借貸對調。
export function reverse(
  input: RuleInput,
  priorJe: JournalEntry,
  priorLotMovements: LotMovement[] = [],
): { je: JournalEntry; lotMovements: LotMovement[] } {
  const key = idempotencyKey(input, priorJe.idempotencyKey);
  const lines: JeLine[] = priorJe.lines.map((l) => ({ ...l, side: l.side === 'DEBIT' ? 'CREDIT' : 'DEBIT' }));
  // reversal lineage 指回 prior；resolved refs 沿用 prior（同一筆原始 resolution）
  const lh = lineageHash({ priceRefs: [], fxRefs: [], consumedLots: [], approvalIds: [priorJe.idempotencyKey] });
  const je: JournalEntry = { idempotencyKey: key, lineageHash: lh, lines, reversalOf: priorJe.idempotencyKey };
  const lotMovements: LotMovement[] = priorLotMovements.map((m) => ({
    ...m,
    deltaQtyMinor: negMinor(m.deltaQtyMinor),
    deltaCostMinor: negMinor(m.deltaCostMinor),
  }));
  return { je, lotMovements };
}

// Public surface for downstream services (snapshot-svc 等)。型別/函式集中由 index 暴露，避免深 import core/。
export { buildMerkle } from './core/merkle.js';
export type { MerkleManifest, InclusionProof } from './core/merkle.js';
export type { RuleInput, RuleOutput, JournalEntry, JeLine, LotMovement, DisclosureFact, RuleException } from './domain/types.js';
export { leafHash, inclusionProof, verifyInclusion } from './core/merkle.js';
export type {
  NormalizedEvent, RunContext, ResolvedPolicySet, ClassificationAssessment,
  PositionLot, PricePoint, FxRate, CoaMapping, EventType,
} from './domain/types.js';
