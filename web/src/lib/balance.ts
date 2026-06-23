// BigInt arithmetic only — amountMinor is a minor-unit string, never a float.
import type { JournalLine } from '../api/types';

export interface BalanceResult {
  functionalDebit: bigint;
  functionalCredit: bigint;
  delta: bigint; // debit - credit (functional ccy)
  balanced: boolean;
}

export function sumFunctional(lines: JournalLine[]): BalanceResult {
  let d = 0n;
  let c = 0n;
  for (const l of lines) {
    const amt = BigInt(l.amountMinor);
    if (l.side === 'DEBIT') d += amt;
    else c += amt;
  }
  return { functionalDebit: d, functionalCredit: c, delta: d - c, balanced: d === c };
}

/** origCoinType subtotals — MEMO only (foreign legs need not net). */
export function origMemo(lines: JournalLine[]): Record<string, bigint> {
  const memo: Record<string, bigint> = {};
  for (const l of lines) {
    if (!l.origCoinType || !l.origQtyMinor) continue;
    const q = BigInt(l.origQtyMinor);
    memo[l.origCoinType] = (memo[l.origCoinType] ?? 0n) + (l.side === 'DEBIT' ? q : -q);
  }
  return memo;
}
