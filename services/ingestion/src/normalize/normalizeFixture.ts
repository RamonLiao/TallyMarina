import { deconstruct } from '../core/deconstruct.js';
import { contentHash } from '../core/contentHash.js';
import type { RawTxEnvelope } from '../domain/types.js';

export interface NormalizedFixtureEvent {
  schemaVersion: string;
  eventId: string;
  eventType: 'DIGITAL_ASSET_RECEIPT' | 'DIGITAL_ASSET_PAYMENT' | 'INTERNAL_TRANSFER' | 'SPOT_TRADE_SWAP' | 'GAS_FEE';
  eventGroupId: string | null;
  entityId: string;
  bookId: string;
  wallet: string;
  counterparty: string | null;
  coinType: string;
  assetDecimals: number;
  quantityMinor: string;
  eventTime: string;
  economicPurpose: string;
  ownershipChange: boolean;
  considerationAsset: string | null;
  considerationQtyMinor: string | null;
  considerationDecimals: number | null;
  rawPayloadHash: string;
  txDigest: string;
  eventIndex: number;
}

export interface FixtureBundle {
  chainId: string;
  epoch: number;
  events: Array<{
    raw: RawTxEnvelope;
    normalized: Omit<NormalizedFixtureEvent, 'rawPayloadHash' | 'txDigest' | 'eventIndex'>;
  }>;
}

/**
 * Turn a hand-curated, recording-safe fixture into NormalizedFixtureEvent[].
 * deconstruct() is run over each raw envelope purely as an OVERFLOW GUARD + to keep
 * the raw→effect path exercised; the accounting fields come from the curated `normalized`
 * block (the demo does not infer them). Lineage (txDigest, eventIndex, rawPayloadHash)
 * is derived deterministically here so two ingests of the same fixture are identical.
 */
export function normalizeFixture(
  fixture: FixtureBundle,
  opts: { maxEffects?: number } = {},
): NormalizedFixtureEvent[] {
  const out: NormalizedFixtureEvent[] = [];
  for (let i = 0; i < fixture.events.length; i++) {
    const row = fixture.events[i]!;
    const { overflow } = deconstruct(row.raw, opts);
    if (overflow) {
      throw new Error(`FIXTURE_OVERFLOW: event index ${i} (digest=${row.raw.digest}) exceeded maxEffects`);
    }
    out.push({
      ...row.normalized,
      rawPayloadHash: contentHash(row.raw.rawJson),
      txDigest: row.raw.digest,
      eventIndex: i,
    });
  }
  return out;
}
