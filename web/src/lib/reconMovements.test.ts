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
const usdcType = '0xusdc::usdc::USDC';

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
