import { describe, it, expect } from 'vitest';
import { DEMO_POLICY_SET, DEMO_COA_RULES, resolveCoa, buildCoaMapping } from '../src/http/policyConstants.js';

describe('policyConstants', () => {
  it('DEMO_POLICY_SET preserves the demo-ps-1 values verbatim', () => {
    expect(DEMO_POLICY_SET.policySetVersion).toBe('demo-ps-1');
    expect(DEMO_POLICY_SET.costBasisMethod).toBe('FIFO');
    expect(DEMO_POLICY_SET.functionalCurrency).toBe('USD');
    expect(DEMO_POLICY_SET.roundingThresholdMinor).toBe('0');
    expect(DEMO_POLICY_SET.periodOpen).toBe(true);
  });

  // WHY: the old 'L1' rules never matched a real engine leg, so every line fell
  // through to the Suspense fallback — unclassified amounts were auto-balanced and
  // anchored (spec §6.5 violation, review C3). These tests pin the real leg names
  // and the fail-closed null.
  it('resolveCoa maps the REAL rules-engine leg names', () => {
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'ACQUISITION' })).toBe('DigitalAssets');
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'RECEIVABLE_SETTLEMENT' })).toBe('AccountsReceivable');
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'EXPENSE' })).toBe('AccountsPayable');
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'DISPOSAL' })).toBe('DigitalAssets');
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'DISPOSAL_LOSS' })).toBe('DisposalLoss');
    expect(resolveCoa({ eventType: 'GAS_FEE', leg: 'NETWORK_FEE' })).toBe('GasFeeExpense');
    // INTERNAL_TRANSFER legs are dynamic WALLET:<addr> — only this type keeps a catch-all.
    expect(resolveCoa({ eventType: 'INTERNAL_TRANSFER', leg: 'WALLET:0xabc' })).toBe('DigitalAssets');
  });

  it('resolveCoa fail-closes to null — no suspense fallback', () => {
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'NO_SUCH_LEG' })).toBeNull();
    expect(resolveCoa({ eventType: 'UNKNOWN_TYPE', leg: 'ACQUISITION' })).toBeNull();
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'ACQUISITION' }, [])).toBeNull();
  });

  it('no catch-all rules except INTERNAL_TRANSFER (dynamic wallet legs)', () => {
    const catchAlls = DEMO_COA_RULES.filter((r) => r.leg === '*');
    expect(catchAlls.map((r) => r.eventType)).toEqual(['INTERNAL_TRANSFER']);
  });

  it('buildCoaMapping yields a CoaMapping whose resolve matches resolveCoa (incl. null)', () => {
    const m = buildCoaMapping();
    expect(m.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT' as never, leg: 'ACQUISITION', coinType: 'X' })).toBe('DigitalAssets');
    expect(m.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT' as never, leg: 'NOPE', coinType: 'X' })).toBeNull();
  });

  it('DEMO_COA_RULES is JSON-serializable (no functions)', () => {
    expect(JSON.parse(JSON.stringify(DEMO_COA_RULES))).toEqual(DEMO_COA_RULES);
  });
});
