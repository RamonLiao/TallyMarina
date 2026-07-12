import type { PositionLot, JournalEntry, JeLine, RuleException } from '../domain/types.js';
import { lineageHash } from '../core/idempotency.js';
import { valueOfQty } from './value.js';
import type { RevalueInput, RevalueOutput, LotValuationDraft, ValuationBasis } from './types.js';

function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x); else m.set(k, [x]);
  }
  return m;
}

function priceMissing(coinType: string): RuleException {
  return { phase: 12, code: 'PRICE_MISSING', detail: { coinType } };
}

function draft(
  lot: PositionLot, prior: bigint, current: bigint, delta: bigint, pricePointId: string, basis: ValuationBasis,
): LotValuationDraft {
  return {
    lotId: lot.lotId,
    seq: 1,
    basis,
    qtyMinor: lot.remainingQtyMinor,
    priorCarryingMinor: prior.toString(),
    currentValueMinor: current.toString(),
    deltaMinor: delta.toString(),
    pricePointId,
    reason: 'REVALUE',
  };
}

function gaapFvJe(input: RevalueInput, coinType: string, netDelta: bigint, pricePointId: string): JournalEntry {
  const amount = (netDelta < 0n ? -netDelta : netDelta).toString();
  const lines: JeLine[] = netDelta > 0n
    ? [
        { account: 'DigitalAssets', side: 'DEBIT', amountMinor: amount, origCoinType: coinType, origQtyMinor: null, priceRef: pricePointId, fxRef: null, leg: 'REVALUE' },
        { account: 'UnrealizedGainCryptoPnL', side: 'CREDIT', amountMinor: amount, origCoinType: coinType, origQtyMinor: null, priceRef: pricePointId, fxRef: null, leg: 'REVALUE' },
      ]
    : [
        { account: 'UnrealizedLossCryptoPnL', side: 'DEBIT', amountMinor: amount, origCoinType: coinType, origQtyMinor: null, priceRef: pricePointId, fxRef: null, leg: 'REVALUE' },
        { account: 'DigitalAssets', side: 'CREDIT', amountMinor: amount, origCoinType: coinType, origQtyMinor: null, priceRef: pricePointId, fxRef: null, leg: 'REVALUE' },
      ];
  const idempotencyKey = `reval:${input.keyBase}:${coinType}`;
  const lh = lineageHash({ priceRefs: [pricePointId], fxRefs: [], consumedLots: [], approvalIds: [] });
  return { idempotencyKey, lineageHash: lh, lines, reversalOf: null };
}

export function revalueLots(input: RevalueInput): RevalueOutput {
  const out: RevalueOutput = { journalEntries: [], valuations: [], exceptions: [] };
  const byCoin = groupBy(input.lots, (l) => l.coinType);
  for (const [coinType, lots] of byCoin) {
    const px = input.prices.find((p) => p.coinType === coinType);
    if (!px) { out.exceptions.push(priceMissing(coinType)); continue; }
    const decimals = input.decimalsByCoin[coinType];
    if (decimals === undefined) { out.exceptions.push(priceMissing(coinType)); continue; } // registry 缺 → 同 fail-closed
    let netDelta = 0n;
    for (const lot of lots) {
      const v = input.valuations[lot.lotId];
      const prior = BigInt(lot.costMinor) + BigInt(v?.cumulativeDeltaMinor ?? '0');
      const current = BigInt(valueOfQty(lot.remainingQtyMinor, px.unitPriceMinor, decimals));
      const delta = current - prior;
      if (delta === 0n) continue;
      out.valuations.push(draft(lot, prior, current, delta, px.id, input.basis));
      netDelta += delta;
    }
    if (netDelta !== 0n) out.journalEntries.push(gaapFvJe(input, coinType, netDelta, px.id));
  }
  return out;
}
