import { describe, it, expect } from 'vitest';
import { normalizeFixture, type FixtureBundle } from '../src/normalize/normalizeFixture.js';

const baseRaw = {
  digest: 'DIG1', checkpoint: '100', timestampMs: '1700000000000',
  status: 'success' as const,
  rawJson: { balanceChanges: [{ coinType: '0x2::sui::SUI', amount: '5000000000', owner: { AddressOwner: '0xcp' } }] },
};
const bundle: FixtureBundle = {
  chainId: 'testnet', epoch: 1,
  events: [{
    raw: baseRaw,
    normalized: {
      schemaVersion: 'v1', eventId: 'e1', eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
      entityId: 'acme:pilot-001', bookId: 'main', wallet: '0xself', counterparty: '0xcp',
      coinType: '0x2::sui::SUI', assetDecimals: 9, quantityMinor: '5000000000',
      eventTime: '2026-06-01T00:00:00Z', economicPurpose: 'RECEIVABLE_SETTLEMENT',
      ownershipChange: true, considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    },
  }],
};

describe('normalizeFixture', () => {
  it('maps each fixture row to a NormalizedFixtureEvent with lineage from deconstruct', () => {
    const out = normalizeFixture(bundle);
    expect(out).toHaveLength(1);
    expect(out[0]!.eventId).toBe('e1');
    expect(out[0]!.txDigest).toBe('DIG1');       // lineage from raw.digest
    expect(out[0]!.eventIndex).toBe(0);
    expect(out[0]!.rawPayloadHash).toMatch(/^[0-9a-f]{64}$/); // contentHash of rawJson
    expect(out[0]!.quantityMinor).toBe('5000000000');
  });

  it('throws FIXTURE_OVERFLOW when a raw tx produces more effects than the guard allows', () => {
    const many = { ...baseRaw, rawJson: { balanceChanges: Array.from({ length: 3 }, (_, i) => ({ coinType: 'c', amount: String(i), owner: { AddressOwner: 'o' } })) } };
    const over: FixtureBundle = { chainId: 'testnet', epoch: 1, events: [{ raw: many, normalized: bundle.events[0]!.normalized }] };
    expect(() => normalizeFixture(over, { maxEffects: 2 })).toThrowError(/FIXTURE_OVERFLOW/);
  });
});
