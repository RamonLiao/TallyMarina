import { describe, it, expect } from 'vitest';
import { normalizedEventSchema } from '../src/domain/schemas.js';

const valid = {
  schemaVersion: '1', eventId: 'e1', eventType: 'DIGITAL_ASSET_RECEIPT',
  eventGroupId: null, entityId: 'ent', bookId: 'bk', wallet: '0xA', counterparty: null,
  coinType: '0x2::sui::SUI', assetDecimals: 0, quantityMinor: '100', eventTime: '2026-06-01T00:00:00Z',
  economicPurpose: 'RECEIVABLE_SETTLEMENT', ownershipChange: true, considerationAsset: null,
  considerationQtyMinor: null, considerationDecimals: null,
  rawPayloadHash: 'h', txDigest: 'd', eventIndex: 0,
};

describe('normalizedEventSchema', () => {
  it('accepts a valid receipt event', () => {
    expect(normalizedEventSchema.parse(valid).eventType).toBe('DIGITAL_ASSET_RECEIPT');
  });
  it('rejects float amount (number not allowed; string must be integer)', () => {
    // why: 金額禁 JS number / 禁小數字串，避免 binary float 誤入帳
    expect(() => normalizedEventSchema.parse({ ...valid, quantityMinor: '1.5' })).toThrow();
  });
  it('rejects unknown event type', () => {
    expect(() => normalizedEventSchema.parse({ ...valid, eventType: 'AIRDROP' })).toThrow();
  });
});
