// web/src/lib/policyPreview.test.ts
import { describe, it, expect } from 'vitest';
import { previewCoaRemap, resolveCoaRule, type PreviewInput } from './policyPreview';
import type { JournalDTO, EventDTO, CoaRuleDTO } from '../api/types';

const baseRules: CoaRuleDTO[] = [
  { eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'DigitalAssets' },
  { eventType: 'DIGITAL_ASSET_RECEIPT', leg: '*', account: 'AccountsReceivable' },
];
const events: EventDTO[] = [
  { id: 'e1', entityId: 'x', status: 'POSTED', normalized: {}, ai: { eventType: 'DIGITAL_ASSET_RECEIPT', purpose: '', counterparty: null, confidence: 1, reasoning: '' }, final: { eventType: 'DIGITAL_ASSET_RECEIPT', purpose: '' }, routing: null },
];
const je = (lines: any[]): JournalDTO => ({ id: 'j1', eventId: 'e1', idempotencyKey: 'k1', leafHash: 'h', je: { idempotencyKey: 'k1', lineageHash: 'lh', reversalOf: null, lines } });

function line(account: string, side: 'DEBIT'|'CREDIT', amt: string, leg: string) {
  return { account, side, amountMinor: amt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg };
}

describe('resolveCoaRule', () => {
  it('first-match by eventType + (leg or *), else default', () => {
    expect(resolveCoaRule(baseRules, 'Suspense', 'DIGITAL_ASSET_RECEIPT', 'L1')).toBe('DigitalAssets');
    expect(resolveCoaRule(baseRules, 'Suspense', 'DIGITAL_ASSET_RECEIPT', 'L2')).toBe('AccountsReceivable');
    expect(resolveCoaRule(baseRules, 'Suspense', 'OTHER', 'L1')).toBe('Suspense');
  });
});

describe('previewCoaRemap', () => {
  const base: Omit<PreviewInput, 'nextRules' | 'nextDefault'> = {
    journal: [je([line('DigitalAssets', 'DEBIT', '1000', 'L1'), line('AccountsReceivable', 'CREDIT', '1000', 'L2')])],
    events, baseRules, baseDefault: 'Suspense',
    knownAccounts: ['DigitalAssets', 'AccountsReceivable', 'CryptoHoldings', 'Suspense'],
  };

  it('reports a changed line when a rule remaps an account', () => {
    const r = previewCoaRemap({ ...base, nextRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'CryptoHoldings' }, baseRules[1]!], nextDefault: 'Suspense' });
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0]).toMatchObject({ fromAccount: 'DigitalAssets', toAccount: 'CryptoHoldings', leg: 'L1' });
  });

  it('conserves grand totals (pure reclassification, debits=credits unchanged)', () => {
    const r = previewCoaRemap({ ...base, nextRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'CryptoHoldings' }, baseRules[1]!], nextDefault: 'Suspense' });
    expect(r.conservation.balanced).toBe(true);
    expect(r.conservation.beforeDebit).toBe(r.conservation.afterDebit);
    expect(r.conservation.beforeCredit).toBe(r.conservation.afterCredit);
  });

  it('conservation.balanced is false for an unbalanced journal (debit 1000, credit 600)', () => {
    // An unbalanced journal must not silently pass the invariant check.
    // beforeDebit(1000) !== beforeCredit(600) → balanced must be false.
    const unbalancedJe = je([
      line('DigitalAssets', 'DEBIT', '1000', 'L1'),
      line('AccountsReceivable', 'CREDIT', '600', 'L2'),
    ]);
    const r = previewCoaRemap({
      ...base,
      journal: [unbalancedJe],
      nextRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'CryptoHoldings' }, baseRules[1]!],
      nextDefault: 'Suspense',
    });
    expect(r.conservation.balanced).toBe(false);
  });

  it('coverage: counts legs that fall to the default', () => {
    const r = previewCoaRemap({ ...base, nextRules: [], nextDefault: 'Suspense' });
    expect(r.coverage.defaulted).toBe(2);
    expect(r.coverage.defaultedKeys).toContain('DIGITAL_ASSET_RECEIPT/L1');
  });

  it('warns UNKNOWN_ACCOUNT when remap targets an account outside knownAccounts', () => {
    const r = previewCoaRemap({ ...base, nextRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'MadeUpAcct' }, baseRules[1]!], nextDefault: 'Suspense' });
    expect(r.warnings.some(w => w.kind === 'UNKNOWN_ACCOUNT' && w.detail.includes('MadeUpAcct'))).toBe(true);
  });

  it('flags ORPHANED_BALANCE when an account disappears from the after-activity', () => {
    const r = previewCoaRemap({ ...base, nextRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'CryptoHoldings' }, baseRules[1]!], nextDefault: 'Suspense' });
    expect(r.warnings.some(w => w.kind === 'ORPHANED_BALANCE' && w.detail.includes('DigitalAssets'))).toBe(true);
  });

  it('flags REVERSAL_DIVERGENCE when an entry and its reversal would remap differently', () => {
    // Original JE uses eventType 'DIGITAL_ASSET_RECEIPT' (e1), reversal uses 'DIGITAL_ASSET_SALE' (e2).
    // nextRules maps DIGITAL_ASSET_RECEIPT/L1 → CryptoHoldings, DIGITAL_ASSET_SALE/L1 → Revenue.
    // Same leg 'L1', but the two JEs resolve to different toAccounts → REVERSAL_DIVERGENCE must fire.
    const e2: EventDTO = { id: 'e2', entityId: 'x', status: 'POSTED', normalized: {}, ai: { eventType: 'DIGITAL_ASSET_SALE', purpose: '', counterparty: null, confidence: 1, reasoning: '' }, final: { eventType: 'DIGITAL_ASSET_SALE', purpose: '' }, routing: null };
    const origJe: JournalDTO = { id: 'j1', eventId: 'e1', idempotencyKey: 'k1', leafHash: 'h1', je: { idempotencyKey: 'k1', lineageHash: 'lh1', reversalOf: null, lines: [line('DigitalAssets', 'DEBIT', '1000', 'L1')] } };
    const revJe: JournalDTO = { id: 'j2', eventId: 'e2', idempotencyKey: 'k2', leafHash: 'h2', je: { idempotencyKey: 'k2', lineageHash: 'lh2', reversalOf: 'k1', lines: [line('DigitalAssets', 'CREDIT', '1000', 'L1')] } };
    const divergingRules: CoaRuleDTO[] = [
      { eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'CryptoHoldings' },
      { eventType: 'DIGITAL_ASSET_SALE', leg: 'L1', account: 'Revenue' },
    ];
    const r = previewCoaRemap({
      ...base,
      journal: [origJe, revJe],
      events: [...events, e2],
      nextRules: divergingRules,
      nextDefault: 'Suspense',
      knownAccounts: ['DigitalAssets', 'AccountsReceivable', 'CryptoHoldings', 'Revenue', 'Suspense'],
    });
    expect(r.warnings.some(w => w.kind === 'REVERSAL_DIVERGENCE')).toBe(true);
  });

  it('empty journal → empty result, no throw', () => {
    const r = previewCoaRemap({ ...base, journal: [], nextRules: baseRules, nextDefault: 'Suspense' });
    expect(r.changed).toEqual([]);
    expect(r.conservation.balanced).toBe(true);
  });

  it("normalizes empty/whitespace amountMinor (no BigInt('') throw)", () => {
    const dirty = je([{ ...line('DigitalAssets', 'DEBIT', '', 'L1'), amountMinor: '  ' }]);
    expect(() => previewCoaRemap({ ...base, journal: [dirty], nextRules: baseRules, nextDefault: 'Suspense' })).not.toThrow();
  });
});
