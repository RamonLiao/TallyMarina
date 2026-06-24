// web/src/lib/policyPreview.ts
// PURE. No React, no fetch. Immutable inputs. BigInt minor-unit math only.
import type { JournalDTO, EventDTO, CoaRuleDTO } from '../api/types';

export interface PreviewInput {
  journal: JournalDTO[]; events: EventDTO[];
  baseRules: CoaRuleDTO[]; baseDefault: string;
  nextRules: CoaRuleDTO[]; nextDefault: string;
  knownAccounts: string[];
}
export interface LineDiff { jeId: string; eventId: string; eventType: string; leg: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string; fromAccount: string; toAccount: string }
export interface CoverageReport { explicit: number; defaulted: number; defaultedKeys: string[] }
export interface Conservation { balanced: boolean; beforeDebit: string; beforeCredit: string; afterDebit: string; afterCredit: string }
export interface Warning { kind: 'UNKNOWN_ACCOUNT' | 'ORPHANED_BALANCE' | 'CROSS_STATEMENT' | 'REVERSAL_DIVERGENCE' | 'EMPTY_ACCOUNT'; detail: string }
export interface AccountActivityDTO { account: string; debitMinor: string; creditMinor: string }
export interface PreviewResult { changed: LineDiff[]; coverage: CoverageReport; conservation: Conservation; warnings: Warning[]; beforeActivity: AccountActivityDTO[]; afterActivity: AccountActivityDTO[] }

function toBig(s: string): bigint { const t = (s ?? '').trim(); return t === '' ? 0n : BigInt(t); }
const legStr = (leg: unknown): string => (leg == null ? '' : String(leg));

export function resolveCoaRule(rules: CoaRuleDTO[], defaultAccount: string, eventType: string, leg: string): string {
  const hit = rules.find((r) => r.eventType === eventType && (r.leg === leg || r.leg === '*'));
  return hit ? hit.account : defaultAccount;
}

export function eventTypeOf(je: JournalDTO, eventsById: Map<string, EventDTO>): string {
  const ev = eventsById.get(je.eventId);
  return ev?.final?.eventType ?? ev?.ai?.eventType ?? '';
}

function activity(rows: { account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }[]): AccountActivityDTO[] {
  const m = new Map<string, { d: bigint; c: bigint }>();
  for (const r of rows) {
    const cur = m.get(r.account) ?? { d: 0n, c: 0n };
    if (r.side === 'DEBIT') cur.d += toBig(r.amountMinor); else cur.c += toBig(r.amountMinor);
    m.set(r.account, cur);
  }
  return [...m.entries()].map(([account, v]) => ({ account, debitMinor: v.d.toString(), creditMinor: v.c.toString() }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

export function previewCoaRemap(input: PreviewInput): PreviewResult {
  const eventsById = new Map(input.events.map((e) => [e.id, e]));
  const known = new Set(input.knownAccounts);
  const changed: LineDiff[] = [];
  const defaultedKeys = new Set<string>();
  let explicit = 0, defaulted = 0;
  const warnings: Warning[] = [];
  const beforeRows: { account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }[] = [];
  const afterRows: typeof beforeRows = [];
  // reversal pairing: idempotencyKey → set of toAccounts (per leg) for divergence check
  const remapByKey = new Map<string, Map<string, string>>(); // idemKey → (leg → toAccount)

  for (const je of input.journal) {
    const eventType = eventTypeOf(je, eventsById);
    const idem = je.je.idempotencyKey;
    for (const ln of je.je.lines) {
      const leg = legStr(ln.leg);
      const hit = input.nextRules.find((r) => r.eventType === eventType && (r.leg === leg || r.leg === '*'));
      const to = hit ? hit.account : input.nextDefault;
      if (hit) explicit++; else { defaulted++; defaultedKeys.add(`${eventType}/${leg}`); }
      if (!to || to.trim() === '') warnings.push({ kind: 'EMPTY_ACCOUNT', detail: `${eventType}/${leg}` });
      else if (!known.has(to)) warnings.push({ kind: 'UNKNOWN_ACCOUNT', detail: `${to} (from ${eventType}/${leg})` });
      beforeRows.push({ account: ln.account, side: ln.side, amountMinor: ln.amountMinor });
      afterRows.push({ account: to, side: ln.side, amountMinor: ln.amountMinor });
      if (to !== ln.account) changed.push({ jeId: je.id, eventId: je.eventId, eventType, leg, side: ln.side, amountMinor: ln.amountMinor, fromAccount: ln.account, toAccount: to });
      const legMap = remapByKey.get(idem) ?? new Map<string, string>();
      legMap.set(leg, to); remapByKey.set(idem, legMap);
    }
  }

  // reversal divergence: original idemKey vs reversal's reversalOf must remap identically per leg
  for (const je of input.journal) {
    const rev = je.je.reversalOf;
    if (!rev) continue;
    const origMap = remapByKey.get(rev); const revMap = remapByKey.get(je.je.idempotencyKey);
    if (origMap && revMap) {
      for (const [leg, acct] of revMap) {
        if (origMap.has(leg) && origMap.get(leg) !== acct) warnings.push({ kind: 'REVERSAL_DIVERGENCE', detail: `${je.je.idempotencyKey} leg ${leg}: ${origMap.get(leg)} vs ${acct}` });
      }
    }
  }

  const beforeActivity = activity(beforeRows);
  const afterActivity = activity(afterRows);
  const beforeAccts = new Set(beforeActivity.map((a) => a.account));
  const afterAccts = new Set(afterActivity.map((a) => a.account));
  for (const a of beforeAccts) if (!afterAccts.has(a)) warnings.push({ kind: 'ORPHANED_BALANCE', detail: a });

  const sum = (rows: AccountActivityDTO[], k: 'debitMinor' | 'creditMinor') => rows.reduce((acc, r) => acc + toBig(r[k]), 0n);
  const beforeDebit = sum(beforeActivity, 'debitMinor'), beforeCredit = sum(beforeActivity, 'creditMinor');
  const afterDebit = sum(afterActivity, 'debitMinor'), afterCredit = sum(afterActivity, 'creditMinor');
  const conservation: Conservation = {
    balanced: beforeDebit === beforeCredit && afterDebit === afterCredit,
    beforeDebit: beforeDebit.toString(), beforeCredit: beforeCredit.toString(),
    afterDebit: afterDebit.toString(), afterCredit: afterCredit.toString(),
  };

  return { changed, coverage: { explicit, defaulted, defaultedKeys: [...defaultedKeys] }, conservation, warnings, beforeActivity, afterActivity };
}
