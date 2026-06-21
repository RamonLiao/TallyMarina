import type { RuleInput, RuleException } from '../domain/types.js';
import type { Phase, PipelineCtx } from './context.js';

export function runPipeline(input: RuleInput, phases: Phase[]):
  { exception: RuleException | null; carry: Record<string, unknown> } {
  const ctx: PipelineCtx = { input, carry: {} };
  for (const phase of phases) {
    const ex = phase(ctx);
    if (ex) return { exception: ex, carry: ctx.carry };   // short-circuit, fail-closed
  }
  return { exception: null, carry: ctx.carry };
}
