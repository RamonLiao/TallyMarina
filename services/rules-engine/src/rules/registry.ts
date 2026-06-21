import type { PipelineCtx } from '../pipeline/context.js';
import type { EventType, LotMovement, Measurement, JeLine, DisclosureFact, RuleException } from '../domain/types.js';
import type { ConsumedLot } from '../core/fifo.js';
import { receiptStrategy } from './receiptRules.js';
import { paymentStrategy } from './paymentRules.js';

export interface LotPlan { movements: LotMovement[]; consumed: ConsumedLot[]; }
export interface EventStrategy {
  ruleIds: string[];
  requiresValuation: boolean;
  classify(ctx: PipelineCtx): RuleException | null;
  buildLotPlan(ctx: PipelineCtx): LotPlan | RuleException;
  buildMeasurements(ctx: PipelineCtx): Measurement[];
  buildJeLines(ctx: PipelineCtx): JeLine[] | RuleException;
  buildDisclosure(ctx: PipelineCtx): DisclosureFact[];
}

const STRATEGIES: Partial<Record<EventType, EventStrategy>> = {
  DIGITAL_ASSET_RECEIPT: receiptStrategy,
  DIGITAL_ASSET_PAYMENT: paymentStrategy,
  // Task 6-8 逐一註冊
};

export function getStrategy(t: EventType): EventStrategy {
  const s = STRATEGIES[t];
  if (!s) throw new Error(`no strategy for ${t}`);
  return s;
}
export { STRATEGIES };
