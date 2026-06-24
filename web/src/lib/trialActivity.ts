// DATA ZONE — NEVER import Mascot here.
import type { JournalLine } from '../api/types';

export interface AccountActivity { account: string; debitMinor: bigint; creditMinor: bigint }
export interface ActivityResult { rows: AccountActivity[]; totalDebitMinor: bigint; totalCreditMinor: bigint }

export class ImbalanceError extends Error {
  constructor(public debit: bigint, public credit: bigint) {
    super(`books do not balance: debit ${debit} != credit ${credit}`);
    this.name = 'ImbalanceError';
  }
}

export function trialActivity(lines: JournalLine[]): ActivityResult {
  const byAccount = new Map<string, AccountActivity>();
  let totalDebit = 0n;
  let totalCredit = 0n;
  for (const l of lines) {
    if (typeof l.amountMinor !== 'string' || !/^-?\d+$/.test(l.amountMinor)) {
      throw new Error(`trialActivity: invalid amountMinor ${JSON.stringify(l.amountMinor)} on ${l.account}`);
    }
    const amt = BigInt(l.amountMinor);
    if (amt < 0n) throw new Error(`trialActivity: amountMinor must be non-negative, got ${l.amountMinor} on ${l.account}`);
    const row = byAccount.get(l.account) ?? { account: l.account, debitMinor: 0n, creditMinor: 0n };
    if (l.side === 'DEBIT') { row.debitMinor += amt; totalDebit += amt; }
    else { row.creditMinor += amt; totalCredit += amt; }
    byAccount.set(l.account, row);
  }
  if (totalDebit !== totalCredit) throw new ImbalanceError(totalDebit, totalCredit);
  const rows = [...byAccount.values()].sort((a, b) => a.account.localeCompare(b.account));
  return { rows, totalDebitMinor: totalDebit, totalCreditMinor: totalCredit };
}
