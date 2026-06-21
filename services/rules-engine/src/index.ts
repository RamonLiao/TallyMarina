import type { RuleInput, RuleOutput, RuleException, JournalEntry, JeLine, LotMovement, DisclosureFact } from './domain/types.js';
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
import { idempotencyKey } from './core/idempotency.js';
import { RECEIPT_RULE_IDS } from './rules/receiptRules.js';

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

export function evaluate(input: RuleInput): RuleOutput {
  // Period close gate（§6.6）
  if (!input.policySet.periodOpen && input.runContext.mode !== 'REPLAY') {
    return rejectOutput({ phase: 0, code: 'PERIOD_CLOSED', detail: { periodId: input.runContext.periodId } }, input);
  }

  const key = idempotencyKey(input, null);

  // Replay：已 posted 回原 JE（idempotent）
  if (input.runContext.mode === 'REPLAY' && input.priorJournalEntries?.[key]) {
    return {
      decision: 'POSTABLE',
      assessment: { eventType: input.event.eventType, accountingClass: input.assetAssessment.accountingClass, measurementModel: input.assetAssessment.measurementModel },
      measurements: [], lotMovements: [], journalEntries: [input.priorJournalEntries[key]!],
      disclosureFacts: [], exceptions: [{ phase: 0, code: 'IDEMPOTENT_REPLAY', detail: { key } }],
      explanation: { ...emptyExplanation(), ruleIds: RECEIPT_RULE_IDS },
    };
  }

  const { exception, carry } = runPipeline(input, PHASES);
  if (exception) return rejectOutput(exception, input);

  const je: JournalEntry = { idempotencyKey: key, lines: carry.journalLines as JeLine[], reversalOf: null };
  return {
    decision: 'POSTABLE',
    assessment: { eventType: 'DIGITAL_ASSET_RECEIPT', accountingClass: input.assetAssessment.accountingClass, measurementModel: input.assetAssessment.measurementModel },
    measurements: carry.measurements as RuleOutput['measurements'],
    lotMovements: carry.lotMovements as LotMovement[],
    journalEntries: [je],
    disclosureFacts: carry.disclosureFacts as DisclosureFact[],
    exceptions: [],
    explanation: {
      ruleIds: RECEIPT_RULE_IDS,
      policyVersions: [input.policySet.policySetVersion, input.policySet.ruleVersion],
      priceRefs: [carry.priceRef as string],
      fxRefs: [carry.fxRef as string],
    },
  };
}

// 沖銷：產反向 JE，lineage 指回 prior（§6.6）。金額皆正，僅借貸對調。
export function reverse(input: RuleInput, priorJe: JournalEntry): JournalEntry {
  const key = idempotencyKey(input, priorJe.idempotencyKey);
  const lines: JeLine[] = priorJe.lines.map((l) => ({
    ...l, side: l.side === 'DEBIT' ? 'CREDIT' : 'DEBIT', amountMinor: l.amountMinor,
  }));
  return { idempotencyKey: key, lines, reversalOf: priorJe.idempotencyKey };
}
