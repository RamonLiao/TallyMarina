import type { PositionLot, PricePoint, JournalEntry, JeLine, RuleException } from '../domain/types.js';
import { lineageHash } from '../core/idempotency.js';
import { valueOfQty } from './value.js';
import type { RevalueInput, RevalueOutput, LotValuationDraft, ValuationBasis, ValuationState } from './types.js';

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
  reason: LotValuationDraft['reason'] = 'REVALUE',
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
    reason,
  };
}

// 減損軌：cumulativeImpairment 按剩餘數量比例攤（floor）；無 valuation 或 qtyAtLastValuation 為 0 → 比例視為 1。
// carrying 與 cap2 共用同一計算，確保兩者始終一致（mutation-check：移除此比例會同時使 carrying 與雙上限失真）。
function attributedImpairment(lot: PositionLot, v: ValuationState | undefined): bigint {
  const cumImpair = BigInt(v?.cumulativeImpairmentMinor ?? '0');
  if (cumImpair === 0n) return 0n;
  const qtyAtLast = v?.qtyAtLastValuationMinor;
  if (!v || qtyAtLast === undefined || qtyAtLast === '0') return cumImpair;
  const remainingQty = BigInt(lot.remainingQtyMinor);
  return (cumImpair * remainingQty) / BigInt(qtyAtLast);
}

function impairmentJe(
  input: RevalueInput, coinType: string, totalImpair: bigint, totalReverse: bigint, pricePointId: string,
): JournalEntry {
  const lines: JeLine[] = [];
  if (totalImpair > 0n) {
    const amt = totalImpair.toString();
    lines.push(
      { account: 'ImpairmentLoss', side: 'DEBIT', amountMinor: amt, origCoinType: coinType, origQtyMinor: null, priceRef: pricePointId, fxRef: null, leg: 'IMPAIR' },
      { account: 'DigitalAssets', side: 'CREDIT', amountMinor: amt, origCoinType: coinType, origQtyMinor: null, priceRef: pricePointId, fxRef: null, leg: 'IMPAIR' },
    );
  }
  if (totalReverse > 0n) {
    const amt = totalReverse.toString();
    lines.push(
      { account: 'DigitalAssets', side: 'DEBIT', amountMinor: amt, origCoinType: coinType, origQtyMinor: null, priceRef: pricePointId, fxRef: null, leg: 'REVERSE' },
      { account: 'ImpairmentReversalGain', side: 'CREDIT', amountMinor: amt, origCoinType: coinType, origQtyMinor: null, priceRef: pricePointId, fxRef: null, leg: 'REVERSE' },
    );
  }
  const idempotencyKey = `reval:${input.keyBase}:${coinType}`;
  const lh = lineageHash({ priceRefs: [pricePointId], fxRefs: [], consumedLots: [], approvalIds: [] });
  return { idempotencyKey, lineageHash: lh, lines, reversalOf: null };
}

// IFRS_COST / GAAP_COST：per-lot 減損（一律全額認列）與迴轉（雙上限，GAAP_COST 不迴轉）。
// 迴轉是 per-lot 屬性（cap 依各 lot 自身的 cost/剩餘攤銷減損而定），不像 GAAP_FV 可跨 lot net；
// 但同 coin 各 lot 的 IMPAIR 與 REVERSE 金額分別彙總成同一張 JE 的兩組 lines（IMPAIR 與 REVERSE 不互抵）。
function impairmentTrack(
  input: RevalueInput, coinType: string, lots: PositionLot[], px: PricePoint, decimals: number, out: RevalueOutput,
): void {
  const basis = input.basis; // 'IFRS_COST' | 'GAAP_COST'
  let totalImpair = 0n;
  let totalReverse = 0n;
  for (const lot of lots) {
    const v = input.valuations[lot.lotId];
    const cost = BigInt(lot.costMinor);
    const attributed = attributedImpairment(lot, v);
    const carrying = cost - attributed;
    const value = BigInt(valueOfQty(lot.remainingQtyMinor, px.unitPriceMinor, decimals));
    if (value < carrying) {
      const impairAmt = carrying - value;
      out.valuations.push(draft(lot, carrying, carrying - impairAmt, -impairAmt, px.id, basis, 'IMPAIR'));
      totalImpair += impairAmt;
    } else if (value > carrying) {
      if (basis === 'GAAP_COST') continue; // ASC 350-30: 一律不迴轉，無 JE、無 valuation 列
      const recovery = value - carrying;
      // cap1 與 cap2 在本函式的不變量下恆等：carrying := cost − attributed（見上方賦值），
      // 故 cap1 = cost − carrying = cost − (cost − attributed) = attributed = cap2，代數上必為同一值，
      // 並非巧合或未涵蓋的邊界情況。仍保留兩個獨立 clamp（而非合併成一個變數），是防禦性寫法：
      // 若未來 carrying 改為獨立追蹤（不再由 cost − attributed 推導），兩者才可能分歧，屆時兩個
      // clamp 仍會各自正確生效，不需重寫這段邏輯。
      const cap1 = cost - carrying;        // 迴轉後 carrying 不得超過原成本
      const cap2 = attributed;             // 迴轉總額不得超過按比例攤的已認列減損
      let reverseAmt = recovery;
      if (cap1 < reverseAmt) reverseAmt = cap1;
      if (cap2 < reverseAmt) reverseAmt = cap2;
      if (reverseAmt <= 0n) continue;
      out.valuations.push(draft(lot, carrying, carrying + reverseAmt, reverseAmt, px.id, basis, 'REVERSE'));
      totalReverse += reverseAmt;
    }
    // value === carrying → 無需認列
  }
  if (totalImpair === 0n && totalReverse === 0n) return;
  out.journalEntries.push(impairmentJe(input, coinType, totalImpair, totalReverse, px.id));
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
    if (input.basis !== 'GAAP_FV') { impairmentTrack(input, coinType, lots, px, decimals, out); continue; }
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
