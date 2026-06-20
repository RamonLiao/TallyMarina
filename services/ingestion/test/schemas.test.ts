import { describe, it, expect } from 'vitest';
import { rawTxEnvelopeSchema } from '../src/domain/schemas.js';

describe('rawTxEnvelopeSchema', () => {
  it('accepts a valid envelope', () => {
    const ok = rawTxEnvelopeSchema.parse({
      digest: 'A1', checkpoint: '100', timestampMs: '1700000000000',
      status: 'success', rawJson: { foo: 1 },
    });
    expect(ok.digest).toBe('A1');
  });
  it('rejects numeric checkpoint (must be string to keep precision)', () => {
    expect(() => rawTxEnvelopeSchema.parse({
      digest: 'A1', checkpoint: 100, timestampMs: '1', status: 'success', rawJson: {},
    })).toThrow();
  });
});
