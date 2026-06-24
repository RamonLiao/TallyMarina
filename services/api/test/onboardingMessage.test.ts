// services/api/test/onboardingMessage.test.ts
import { describe, it, expect } from 'vitest';
import { buildOwnershipMessage, encodeOwnershipMessage } from '../src/onboarding/message.js';

const input = { entityId: 'acme:pilot-001', wallet: '0xabc', nonce: 'deadbeef', expiresAt: 1_717_200_000_000 };

describe('ownership message', () => {
  it('builds the exact domain-bound template (string golden)', () => {
    expect(buildOwnershipMessage(input)).toBe(
      [
        'Subledger ownership proof',
        'version: v1',
        'entity: acme:pilot-001',
        'wallet: 0xabc',
        'nonce: deadbeef',
        'expires: 2024-06-01T00:00:00.000Z',
      ].join('\n'),
    );
  });

  it('encodes UTF-8 bytes deterministically (byte golden)', () => {
    const bytes = encodeOwnershipMessage(input);
    // round-trips through TextEncoder; lock length + no trailing newline
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[bytes.length - 1]).not.toBe(0x0a); // no trailing \n
    expect(new TextDecoder().decode(bytes)).toBe(buildOwnershipMessage(input));
  });
});
