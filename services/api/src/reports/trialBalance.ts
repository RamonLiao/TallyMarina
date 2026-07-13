// DATA ZONE — pure computation over persisted stores. No writes.
import type { Db } from '../store/db.js';
import { periodCutoff } from '../store/pricePointStore.js';

export type AccountClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
const DEBIT_NORMAL: ReadonlySet<string> = new Set(['asset', 'expense']);

interface JeLine { account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }
interface JeDoc { status?: string; lines: JeLine[] }

export interface TbRow {
  account: string;
  accountClass: AccountClass | null;
  openingMinor: string;        // 帶號，normal-balance 方向（unknown class 時為 debit-positive 原值）
  debitMinor: string;          // period activity（不含 OPENING_LOT）
  creditMinor: string;
  closingMinor: string | null; // unknown class → null（fail-closed，spec 裁決 5）
}
export interface TbTieOut {
  sumDebitMinor: string;
  sumCreditMinor: string;
  sumSignedClosingMinor: string; // debit-positive 空間之 Σclosing，恆須 "0"
  balanced: boolean;             // ΣDr=ΣCr 且 Σclosing=0 且 failures 空
  failures: string[];            // 可判定原因（unknown-class account 名單、不平差額描述）
}
export interface TrialBalance { rows: TbRow[]; tieOut: TbTieOut }

export function buildTrialBalance(db: Db, entityId: string, periodId: string): TrialBalance {
  const targetCutoff = periodCutoff(periodId); // malformed periodId → throw（沿用既有驗證）
  const jeRows = db.prepare(
    `SELECT je.je_json AS jeJson, je.period_id AS periodId, ev.final_event_type AS eventType
       FROM journal_entries je JOIN events ev ON ev.id = je.event_id
      WHERE je.entity_id = ?`,
  ).all(entityId) as { jeJson: string; periodId: string; eventType: string | null }[];

  const classByAccount = new Map<string, AccountClass>();
  for (const a of db.prepare('SELECT name, class FROM accounts WHERE entity_id = ?')
    .all(entityId) as { name: string; class: AccountClass }[]) classByAccount.set(a.name, a.class);

  // 全程 debit-positive 帶號空間累加；呈現時才轉 normal-balance 方向。
  const opening = new Map<string, bigint>();
  const debit = new Map<string, bigint>();
  const credit = new Map<string, bigint>();
  let sumDr = 0n, sumCr = 0n;

  for (const r of jeRows) {
    const cutoff = periodCutoff(r.periodId);
    if (cutoff > targetCutoff) continue;                        // 未來期一律不入（spec §4.1）
    const je = JSON.parse(r.jeJson) as JeDoc;
    if (je.status === 'VOIDED') continue;                       // §11.1 最終狀態呈現（裁決 7）
    const toOpening = cutoff < targetCutoff || r.eventType === 'OPENING_LOT'; // 裁決 1
    for (const l of je.lines) {
      if (!/^\d+$/.test(l.amountMinor)) {
        throw new Error(`trialBalance: invalid amountMinor ${JSON.stringify(l.amountMinor)} on ${l.account}`);
      }
      const amt = BigInt(l.amountMinor);
      const net = l.side === 'DEBIT' ? amt : -amt;
      if (toOpening) opening.set(l.account, (opening.get(l.account) ?? 0n) + net);
      else if (l.side === 'DEBIT') { debit.set(l.account, (debit.get(l.account) ?? 0n) + amt); sumDr += amt; }
      else { credit.set(l.account, (credit.get(l.account) ?? 0n) + amt); sumCr += amt; }
    }
  }

  const accounts = [...new Set([...opening.keys(), ...debit.keys(), ...credit.keys()])]
    .sort((a, b) => a.localeCompare(b));
  const failures: string[] = [];
  let sumSignedClosing = 0n;
  const rows: TbRow[] = accounts.map((account) => {
    const openNet = opening.get(account) ?? 0n;
    const dr = debit.get(account) ?? 0n;
    const cr = credit.get(account) ?? 0n;
    const closeNet = openNet + dr - cr;
    sumSignedClosing += closeNet;
    const cls = classByAccount.get(account) ?? null;
    if (cls === null) {
      failures.push(`unknown account class: ${account}`);
      return { account, accountClass: null, openingMinor: openNet.toString(),
        debitMinor: dr.toString(), creditMinor: cr.toString(), closingMinor: null };
    }
    const sign = DEBIT_NORMAL.has(cls) ? 1n : -1n; // 呈現：credit-normal 轉正
    return { account, accountClass: cls, openingMinor: (openNet * sign).toString(),
      debitMinor: dr.toString(), creditMinor: cr.toString(), closingMinor: (closeNet * sign).toString() };
  });

  if (sumDr !== sumCr) failures.push(`period activity imbalance: Dr ${sumDr} != Cr ${sumCr}`);
  if (sumSignedClosing !== 0n) failures.push(`signed closing sum != 0: ${sumSignedClosing}`);
  return { rows, tieOut: {
    sumDebitMinor: sumDr.toString(), sumCreditMinor: sumCr.toString(),
    sumSignedClosingMinor: sumSignedClosing.toString(),
    balanced: failures.length === 0, failures } };
}
