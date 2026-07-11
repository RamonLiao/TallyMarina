import { describe, it, expect } from 'vitest';
import { recomputeMovements } from './reconMovements';
import type { JournalDTO, EventDTO } from '../api/types';

const makeEvent = (id: string, wallet: string): EventDTO => ({
  id,
  entityId: 'ent1',
  status: 'POSTED',
  normalized: { wallet },
  ai: null,
  final: null,
  routing: null,
});

const makeJe = (id: string, eventId: string, lines: JournalDTO['je']['lines']): JournalDTO => ({
  id,
  eventId,
  idempotencyKey: `ik-${id}`,
  leafHash: `hash-${id}`,
  je: { idempotencyKey: `ik-${id}`, lineageHash: `lh-${id}`, reversalOf: null, lines },
});

const suiType = '0x2::sui::SUI';
const usdcType = '0xbeef::usdc::USDC';

describe('recomputeMovements', () => {
  it('returns empty map for empty journal', () => {
    expect(recomputeMovements([], [])).toEqual({});
  });

  it('computes correct net per wallet|coinType key — symmetric JE nets to zero', () => {
    // origMemo: DEBIT adds qty, CREDIT subtracts qty.
    // A fully-symmetric JE (DR SUI 100, CR SUI 100) nets to 0 — correct behavior.
    // WHY: real movement JEs have asymmetric orig sides (one leg has orig, the other doesn't).
    const je1 = makeJe('je1', 'ev1', [
      { account: 'asset', side: 'DEBIT', amountMinor: '100', origCoinType: suiType, origQtyMinor: '100', priceRef: null, fxRef: null, leg: null },
      { account: 'equity', side: 'CREDIT', amountMinor: '100', origCoinType: suiType, origQtyMinor: '100', priceRef: null, fxRef: null, leg: null },
    ]);
    const ev1 = makeEvent('ev1', '0xwallet1');
    const result = recomputeMovements([je1], [ev1]);
    // DR 100 SUI + CR 100 SUI → 100 − 100 = 0
    expect(result).toEqual({ [`0xwallet1|${suiType}`]: 0n });
  });

  it('accumulates net correctly across JEs for same key with asymmetric orig lines', () => {
    // Realistic: DR asset:SUI 500 (orig SUI), CR equity:USD 0 (no orig) — net SUI +500
    const je1 = makeJe('je1', 'ev1', [
      { account: 'asset', side: 'DEBIT', amountMinor: '500', origCoinType: suiType, origQtyMinor: '500', priceRef: null, fxRef: null, leg: null },
      { account: 'equity', side: 'CREDIT', amountMinor: '500', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
    ]);
    // JE2: DR expense:USD 200 (no orig), CR asset:SUI 200 (orig SUI) — net SUI −200
    const je2 = makeJe('je2', 'ev2', [
      { account: 'expense', side: 'DEBIT', amountMinor: '200', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
      { account: 'asset', side: 'CREDIT', amountMinor: '200', origCoinType: suiType, origQtyMinor: '200', priceRef: null, fxRef: null, leg: null },
    ]);
    const ev1 = makeEvent('ev1', '0xwallet1');
    const ev2 = makeEvent('ev2', '0xwallet1');

    const result = recomputeMovements([je1, je2], [ev1, ev2]);
    // je1: memo[SUI] = +500; je2: memo[SUI] = −200; net = +300
    expect(result).toEqual({ [`0xwallet1|${suiType}`]: 300n });
  });

  it('separates by wallet and coinType keys', () => {
    const je1 = makeJe('je1', 'ev1', [
      { account: 'asset', side: 'DEBIT', amountMinor: '1000', origCoinType: suiType, origQtyMinor: '1000', priceRef: null, fxRef: null, leg: null },
      { account: 'equity', side: 'CREDIT', amountMinor: '1000', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
    ]);
    const je2 = makeJe('je2', 'ev2', [
      { account: 'asset', side: 'DEBIT', amountMinor: '500', origCoinType: usdcType, origQtyMinor: '500', priceRef: null, fxRef: null, leg: null },
      { account: 'equity', side: 'CREDIT', amountMinor: '500', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null },
    ]);
    const ev1 = makeEvent('ev1', '0xwalletA');
    const ev2 = makeEvent('ev2', '0xwalletB');

    const result = recomputeMovements([je1, je2], [ev1, ev2]);
    expect(result).toEqual({
      [`0xwalletA|${suiType}`]: 1000n,
      [`0xwalletB|${usdcType}`]: 500n,
    });
  });

  // ── OPENING_LOT exclusion — parity with backend walletAssetMovements (movement.ts) ──
  // WHY: OPENING_LOT declares pre-history holdings. Its chain-side counterpart is the recon
  // fixture's openingMinor, NOT a book movement. Folding its ACQUISITION leg in here would
  // double-count the same holding on both sides of `computed = opening + movement`, showing
  // the controller a break that does not exist. The backend skips it; this client mirror must
  // skip it under the SAME discriminator (final.eventType ?? normalized.eventType) or the
  // recon screen silently disagrees with the ledger it is supposed to be checking.
  const makeTypedEvent = (
    id: string, wallet: string,
    rawType: string, finalType?: string,
  ): EventDTO => ({
    id, entityId: 'ent1', status: 'POSTED',
    normalized: { wallet, eventType: rawType },
    ai: null,
    final: finalType ? { eventType: finalType, purpose: 'OPENING_BALANCE' } : null,
    routing: null,
  });

  const openingJe = (id: string, eventId: string) => makeJe(id, eventId, [
    { account: 'DigitalAssets', side: 'DEBIT', amountMinor: '1000000', origCoinType: suiType, origQtyMinor: '1000000000000', priceRef: null, fxRef: null, leg: 'ACQUISITION' },
    { account: 'OpeningBalanceEquity', side: 'CREDIT', amountMinor: '1000000', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'OPENING_EQUITY' },
  ]);

  it('excludes an OPENING_LOT JE from movements', () => {
    const ev = makeTypedEvent('ev-open', '0xwallet1', 'OPENING_LOT');
    // Sole JE is the opening lot → no movement keys at all, not a 1000-SUI phantom movement.
    expect(recomputeMovements([openingJe('je-open', 'ev-open')], [ev])).toEqual({});
  });

  it('counts movement when an event was reclassified AWAY from OPENING_LOT (final wins)', () => {
    // raw OPENING_LOT but a human re-posted it as a real receipt → it IS period activity.
    // Reading normalized.eventType alone would wrongly drop a genuine movement, masking a break.
    const ev = makeTypedEvent('ev1', '0xwallet1', 'OPENING_LOT', 'DIGITAL_ASSET_RECEIPT');
    expect(recomputeMovements([openingJe('je1', 'ev1')], [ev])).toEqual({
      [`0xwallet1|${suiType}`]: 1000000000000n,
    });
  });

  it('excludes when an event was reclassified INTO OPENING_LOT (final wins)', () => {
    // raw receipt, human re-posted as OPENING_LOT → folding it in would double-count.
    const ev = makeTypedEvent('ev1', '0xwallet1', 'DIGITAL_ASSET_RECEIPT', 'OPENING_LOT');
    expect(recomputeMovements([openingJe('je1', 'ev1')], [ev])).toEqual({});
  });

  it('still fails loud on a walletless OPENING_LOT — skip must not swallow integrity gaps', () => {
    // WHY: the skip sits AFTER the wallet check in the backend. If it moved before, a
    // corrupt walletless event would be silently ignored instead of surfacing.
    const ev: EventDTO = {
      id: 'ev-open', entityId: 'ent1', status: 'POSTED',
      normalized: { eventType: 'OPENING_LOT' }, // no wallet
      ai: null, final: null, routing: null,
    };
    expect(() => recomputeMovements([openingJe('je-open', 'ev-open')], [ev]))
      .toThrow(/event ev-open has no normalized.wallet/);
  });

  it('throws when a JE has no matching event — integrity gap must surface', () => {
    const je = makeJe('je-orphan', 'ev-missing', []);
    expect(() => recomputeMovements([je], [])).toThrow(/no event found for JE je-orphan/);
  });

  it('throws when event has no normalized.wallet — integrity gap must surface', () => {
    const je = makeJe('je1', 'ev1', []);
    const ev: EventDTO = {
      id: 'ev1', entityId: 'ent1', status: 'POSTED',
      normalized: {}, // no wallet
      ai: null, final: null, routing: null,
    };
    expect(() => recomputeMovements([je], [ev])).toThrow(/event ev1 has no normalized.wallet/);
  });
});
