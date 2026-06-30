export type JournalLine = { account: string; debit: number; credit: number };

export const sampleEntry = {
  txDigest: '0x9f3ac1d27b4e8a5c0f61d2e7b8a4c903fe12db6740a9c8e35b1f02d7a6c4e98b',
  memo: 'DeepBook swap — USDC → SUI, settled on-chain',
  lines: [
    { account: '1100 · Digital Assets — SUI', debit: 12_480.0, credit: 0 },
    { account: '1020 · Digital Assets — USDC', debit: 0, credit: 12_500.0 },
    { account: '6200 · Trading Fees', debit: 20.0, credit: 0 },
  ] as JournalLine[],
};

export function totals(lines: JournalLine[]): { debit: number; credit: number } {
  return lines.reduce(
    (acc, l) => ({ debit: acc.debit + l.debit, credit: acc.credit + l.credit }),
    { debit: 0, credit: 0 },
  );
}
