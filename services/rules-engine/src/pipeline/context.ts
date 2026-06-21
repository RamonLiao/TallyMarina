import type { RuleInput, RuleException } from '../domain/types.js';
export interface PipelineCtx { input: RuleInput; carry: Record<string, unknown>; }
export type Phase = (ctx: PipelineCtx) => RuleException | null;
