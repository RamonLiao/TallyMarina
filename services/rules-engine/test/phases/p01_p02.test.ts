import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/pipeline/runPipeline.js';
import { phaseSchema } from '../../src/pipeline/phases/p01_schema.js';
import { phaseOwnership } from '../../src/pipeline/phases/p02_ownership.js';
import { makeReceiptInput } from '../fixtures/receipt.js';

describe('phase 1-2', () => {
  it('valid input passes both phases', () => {
    const r = runPipeline(makeReceiptInput('HAPPY'), [phaseSchema, phaseOwnership]);
    expect(r.exception).toBeNull();
  });
  it('phase 1 rejects bad schema with phase=1 SCHEMA_INVALID', () => {
    const bad = makeReceiptInput('HAPPY');
    (bad.event as { quantityMinor: string }).quantityMinor = '1.5';
    const r = runPipeline(bad, [phaseSchema, phaseOwnership]);
    expect(r.exception).toMatchObject({ phase: 1, code: 'SCHEMA_INVALID' });
  });
  it('phase 2 rejects entity mismatch (short-circuits before later phases)', () => {
    // why: ownership boundary 是 fail-closed gate，entity 不一致絕不續算
    const bad = makeReceiptInput('HAPPY');
    bad.runContext.entityId = 'OTHER';
    const r = runPipeline(bad, [phaseSchema, phaseOwnership]);
    expect(r.exception).toMatchObject({ phase: 2, code: 'ENTITY_BOUNDARY' });
  });
});
