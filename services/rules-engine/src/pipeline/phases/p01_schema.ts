import type { Phase } from '../context.js';
import { normalizedEventSchema, runContextSchema } from '../../domain/schemas.js';

export const phaseSchema: Phase = (ctx) => {
  if (!ctx.input.event.schemaVersion) return { phase: 1, code: 'SCHEMA_INVALID', detail: 'missing schemaVersion' };
  const ev = normalizedEventSchema.safeParse(ctx.input.event);
  if (!ev.success) return { phase: 1, code: 'SCHEMA_INVALID', detail: ev.error.issues };
  const rc = runContextSchema.safeParse(ctx.input.runContext);
  if (!rc.success) return { phase: 1, code: 'SCHEMA_INVALID', detail: rc.error.issues };
  return null;
};
