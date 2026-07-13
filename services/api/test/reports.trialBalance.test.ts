import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import { buildTrialBalance } from '../src/reports/trialBalance.js';
import { ACCOUNT_SEED } from '../src/store/policyStore.js';
import type { Db } from '../src/store/db.js';

type AccountClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
interface JeLine { account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }

let jeSeq = 0;

// Minimal direct-INSERT seed helper (private to this file):
// INSERTs events(id, entity_id, status='POSTED', final_event_type=eventType, period_id, raw_json='{}')
// and journal_entries(id, entity_id, event_id, je_json=JSON.stringify({status, lines}), period_id, ...
// idempotency_key/leaf_hash filled with dummy unique values — schema requires NOT NULL UNIQUE).
function insertJe(
  db: Db,
  opts: { periodId: string; eventType?: string; lines: JeLine[]; status?: string },
): string {
  jeSeq += 1;
  const id = `je-${jeSeq}`;
  const eventId = `ev-${jeSeq}`;
  db.prepare(
    `INSERT INTO events (id, entity_id, raw_json, status, final_event_type, period_id)
     VALUES (?, ?, '{}', 'POSTED', ?, ?)`,
  ).run(eventId, TEST_ENTITY_ID, opts.eventType ?? null, opts.periodId);
  const jeJson = JSON.stringify({ status: opts.status, lines: opts.lines });
  db.prepare(
    `INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, TEST_ENTITY_ID, eventId, jeJson, `idem-${id}`, `hash-${id}`, opts.periodId);
  return id;
}

function insertAccount(db: Db, name: string, cls: AccountClass): void {
  db.prepare(
    `INSERT INTO accounts (entity_id, name, class, source_section, status) VALUES (?, ?, ?, '§test', 'active')`,
  ).run(TEST_ENTITY_ID, name, cls);
}

// Deterministic PRNG (mulberry32) — no bare Math.random() calls in the property test.
function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generates 30 individually-balanced JEs from a fixed-seed PRNG into `periodId`.
// If mutateIdx is given, the FIRST line's amountMinor of that JE gets +1 added AFTER the
// balancing last line was already computed — this unbalances exactly that JE by 1 minor unit.
function genScenario(db: Db, periodId: string, mutateIdx?: number): void {
  const rng = mulberry32(0xc0ffee01);
  const accounts = ACCOUNT_SEED.map((a) => a.name);
  for (let i = 0; i < 30; i += 1) {
    const lineCount = 2 + Math.floor(rng() * 3); // 2..4
    const lines: JeLine[] = [];
    let net = 0;
    for (let j = 0; j < lineCount - 1; j += 1) {
      const account = accounts[Math.floor(rng() * accounts.length)]!;
      const side: 'DEBIT' | 'CREDIT' = rng() < 0.5 ? 'DEBIT' : 'CREDIT';
      const amount = 1 + Math.floor(rng() * 1000);
      lines.push({ account, side, amountMinor: String(amount) });
      net += side === 'DEBIT' ? amount : -amount;
    }
    const lastAccount = accounts[Math.floor(rng() * accounts.length)]!;
    const lastSide: 'DEBIT' | 'CREDIT' = net > 0 ? 'CREDIT' : 'DEBIT';
    const lastAmount = Math.abs(net);
    lines.push({ account: lastAccount, side: lastSide, amountMinor: String(lastAmount) });
    if (i === mutateIdx) {
      const bumped = BigInt(lines[0]!.amountMinor) + 1n;
      lines[0] = { ...lines[0]!, amountMinor: bumped.toString() };
    }
    insertJe(db, { periodId, lines });
  }
}

describe('buildTrialBalance', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let db: Db;

  beforeEach(async () => {
    app = await buildTestApp();
    db = app._db;
  });

  it('方向推導：五類 class 的 closing 帶號正確', () => {
    insertAccount(db, 'TAsset', 'asset');
    insertAccount(db, 'TLiability', 'liability');
    insertAccount(db, 'TEquity', 'equity');
    insertAccount(db, 'TIncome', 'income');
    insertAccount(db, 'TExpense', 'expense');
    insertAccount(db, 'TPlug', 'asset');

    // asset 100 Dr → closing +100（借餘）
    insertJe(db, { periodId: '2026-Q2', lines: [
      { account: 'TAsset', side: 'DEBIT', amountMinor: '100' },
      { account: 'TPlug', side: 'CREDIT', amountMinor: '100' },
    ] });
    // income 100 Cr → closing +100（貸餘，呈現為正）
    insertJe(db, { periodId: '2026-Q2', lines: [
      { account: 'TPlug', side: 'DEBIT', amountMinor: '100' },
      { account: 'TIncome', side: 'CREDIT', amountMinor: '100' },
    ] });
    // liability 100 Cr → closing +100
    insertJe(db, { periodId: '2026-Q2', lines: [
      { account: 'TPlug', side: 'DEBIT', amountMinor: '100' },
      { account: 'TLiability', side: 'CREDIT', amountMinor: '100' },
    ] });
    // equity 100 Cr → closing +100
    insertJe(db, { periodId: '2026-Q2', lines: [
      { account: 'TPlug', side: 'DEBIT', amountMinor: '100' },
      { account: 'TEquity', side: 'CREDIT', amountMinor: '100' },
    ] });
    // expense 100 Dr → closing +100
    insertJe(db, { periodId: '2026-Q2', lines: [
      { account: 'TExpense', side: 'DEBIT', amountMinor: '100' },
      { account: 'TPlug', side: 'CREDIT', amountMinor: '100' },
    ] });

    const tb = buildTrialBalance(db, TEST_ENTITY_ID, '2026-Q2');
    const byAccount = new Map(tb.rows.map((r) => [r.account, r]));

    expect(byAccount.get('TAsset')?.closingMinor).toBe('100');
    expect(byAccount.get('TAsset')?.debitMinor).toBe('100');
    expect(byAccount.get('TAsset')?.creditMinor).toBe('0');

    expect(byAccount.get('TIncome')?.closingMinor).toBe('100');
    expect(byAccount.get('TIncome')?.debitMinor).toBe('0');
    expect(byAccount.get('TIncome')?.creditMinor).toBe('100');

    expect(byAccount.get('TLiability')?.closingMinor).toBe('100');
    expect(byAccount.get('TEquity')?.closingMinor).toBe('100');
    expect(byAccount.get('TExpense')?.closingMinor).toBe('100');
  });

  it('tie-out：平衡 JE 集 → balanced=true，sumSignedClosingMinor="0"', () => {
    insertAccount(db, 'TAsset', 'asset');
    insertAccount(db, 'TIncome', 'income');
    insertJe(db, { periodId: '2026-Q2', lines: [
      { account: 'TAsset', side: 'DEBIT', amountMinor: '250' },
      { account: 'TIncome', side: 'CREDIT', amountMinor: '250' },
    ] });

    const tb = buildTrialBalance(db, TEST_ENTITY_ID, '2026-Q2');
    expect(tb.tieOut.balanced).toBe(true);
    expect(tb.tieOut.sumSignedClosingMinor).toBe('0');
    expect(tb.tieOut.sumDebitMinor).toBe('250');
    expect(tb.tieOut.sumCreditMinor).toBe('250');
    expect(tb.tieOut.failures).toEqual([]);
  });

  it('跨期 opening：Q2 的 JE 折入 Q3 的 openingMinor，不入 Q3 movement', () => {
    insertAccount(db, 'TAsset', 'asset');
    insertAccount(db, 'TPlug', 'asset');
    insertJe(db, { periodId: '2026-Q2', lines: [
      { account: 'TAsset', side: 'DEBIT', amountMinor: '100' },
      { account: 'TPlug', side: 'CREDIT', amountMinor: '100' },
    ] });

    const tb = buildTrialBalance(db, TEST_ENTITY_ID, '2026-Q3');
    const row = tb.rows.find((r) => r.account === 'TAsset')!;
    expect(row.openingMinor).toBe('100');
    expect(row.debitMinor).toBe('0');
    expect(row.creditMinor).toBe('0');
    expect(row.closingMinor).toBe('100');
  });

  it('OPENING_LOT 歸 opening：目標期的 OPENING_LOT JE 兩腿都進 opening，Dr/Cr movement 為 0（spec 裁決 1）', () => {
    insertAccount(db, 'TAsset', 'asset');
    insertAccount(db, 'TPlug', 'asset');
    insertJe(db, {
      periodId: '2026-Q3',
      eventType: 'OPENING_LOT',
      lines: [
        { account: 'TAsset', side: 'DEBIT', amountMinor: '75' },
        { account: 'TPlug', side: 'CREDIT', amountMinor: '75' },
      ],
    });

    const tb = buildTrialBalance(db, TEST_ENTITY_ID, '2026-Q3');
    const row = tb.rows.find((r) => r.account === 'TAsset')!;
    expect(row.openingMinor).toBe('75');
    expect(row.debitMinor).toBe('0');
    expect(row.creditMinor).toBe('0');
    expect(row.closingMinor).toBe('75');
  });

  it('period > 目標期的 JE 一律不入（含 OPENING_LOT）', () => {
    insertAccount(db, 'TAsset', 'asset');
    insertAccount(db, 'TPlug', 'asset');
    insertJe(db, {
      periodId: '2026-Q4',
      eventType: 'OPENING_LOT',
      lines: [
        { account: 'TAsset', side: 'DEBIT', amountMinor: '50' },
        { account: 'TPlug', side: 'CREDIT', amountMinor: '50' },
      ],
    });

    const tb = buildTrialBalance(db, TEST_ENTITY_ID, '2026-Q3');
    expect(tb.rows).toEqual([]);
    expect(tb.tieOut.balanced).toBe(true);
  });

  it('首期：無前期 JE 時 opening 僅含該期 OPENING_LOT', () => {
    insertAccount(db, 'TAsset', 'asset');
    insertAccount(db, 'TPlug', 'asset');
    insertJe(db, {
      periodId: '2026-Q1',
      eventType: 'OPENING_LOT',
      lines: [
        { account: 'TAsset', side: 'DEBIT', amountMinor: '40' },
        { account: 'TPlug', side: 'CREDIT', amountMinor: '40' },
      ],
    });

    const tb = buildTrialBalance(db, TEST_ENTITY_ID, '2026-Q1');
    expect(tb.rows.map((r) => r.account).sort()).toEqual(['TAsset', 'TPlug']);
    const row = tb.rows.find((r) => r.account === 'TAsset')!;
    expect(row.openingMinor).toBe('40');
    expect(row.debitMinor).toBe('0');
    expect(row.creditMinor).toBe('0');
    expect(row.closingMinor).toBe('40');
  });

  it('空期：無 JE → rows=[]、balanced=true、sums="0"', () => {
    const tb = buildTrialBalance(db, TEST_ENTITY_ID, '2026-Q2');
    expect(tb.rows).toEqual([]);
    expect(tb.tieOut.balanced).toBe(true);
    expect(tb.tieOut.sumDebitMinor).toBe('0');
    expect(tb.tieOut.sumCreditMinor).toBe('0');
    expect(tb.tieOut.sumSignedClosingMinor).toBe('0');
  });

  it('unknown-class fail-closed：account 不在 accounts 表 → 該列 accountClass=null、closingMinor=null、balanced=false、failures 含 account 名（spec 裁決 5）', () => {
    insertAccount(db, 'TPlug', 'asset');
    insertJe(db, { periodId: '2026-Q2', lines: [
      { account: 'GhostAccount', side: 'DEBIT', amountMinor: '100' },
      { account: 'TPlug', side: 'CREDIT', amountMinor: '100' },
    ] });

    const tb = buildTrialBalance(db, TEST_ENTITY_ID, '2026-Q2');
    const row = tb.rows.find((r) => r.account === 'GhostAccount')!;
    expect(row.accountClass).toBeNull();
    expect(row.closingMinor).toBeNull();
    expect(tb.tieOut.balanced).toBe(false);
    expect(tb.tieOut.failures.some((f) => f.includes('GhostAccount'))).toBe(true);
  });

  it('VOIDED filter：je_json.status="VOIDED" 的 JE 不入任何欄（spec 裁決 7 防禦性）', () => {
    insertAccount(db, 'TAsset', 'asset');
    insertAccount(db, 'TPlug', 'asset');
    insertJe(db, {
      periodId: '2026-Q2',
      status: 'VOIDED',
      lines: [
        { account: 'TAsset', side: 'DEBIT', amountMinor: '100' },
        { account: 'TPlug', side: 'CREDIT', amountMinor: '100' },
      ],
    });

    const tb = buildTrialBalance(db, TEST_ENTITY_ID, '2026-Q2');
    expect(tb.rows).toEqual([]);
    expect(tb.tieOut.balanced).toBe(true);
  });

  it('非法 amountMinor（"1.5"、"abc"、""）→ throw（fail-loud，不靜默跳過）', async () => {
    for (const bad of ['1.5', 'abc', '']) {
      const isolatedApp = await buildTestApp();
      const isolatedDb = isolatedApp._db;
      insertAccount(isolatedDb, 'TAsset', 'asset');
      insertAccount(isolatedDb, 'TPlug', 'asset');
      insertJe(isolatedDb, { periodId: '2026-Q2', lines: [
        { account: 'TAsset', side: 'DEBIT', amountMinor: bad },
        { account: 'TPlug', side: 'CREDIT', amountMinor: '0' },
      ] });
      expect(() => buildTrialBalance(isolatedDb, TEST_ENTITY_ID, '2026-Q2')).toThrow(
        `invalid amountMinor ${JSON.stringify(bad)}`,
      );
    }
  });

  it('property：隨機平衡 JE 集 → tie-out 永真；弄壞任一條 → 必紅', async () => {
    const rngK = mulberry32(0xc0ffee02);
    const k = Math.floor(rngK() * 30);

    genScenario(db, '2026-Q2');
    const tb1 = buildTrialBalance(db, TEST_ENTITY_ID, '2026-Q2');
    expect(tb1.tieOut.balanced).toBe(true);

    const app2 = await buildTestApp();
    genScenario(app2._db, '2026-Q2', k);
    const tb2 = buildTrialBalance(app2._db, TEST_ENTITY_ID, '2026-Q2');
    expect(tb2.tieOut.balanced).toBe(false);
  });
});
