import { describe, it, expect } from 'vitest';
import { DEMO_POLICY_SET, DEMO_COA_RULES, DEMO_DEFAULT_ACCOUNT, resolveCoa, buildCoaMapping } from '../src/http/policyConstants.js';

describe('policyConstants', () => {
  it('DEMO_POLICY_SET preserves the demo-ps-1 values verbatim', () => {
    expect(DEMO_POLICY_SET.policySetVersion).toBe('demo-ps-1');
    expect(DEMO_POLICY_SET.costBasisMethod).toBe('FIFO');
    expect(DEMO_POLICY_SET.functionalCurrency).toBe('USD');
    expect(DEMO_POLICY_SET.roundingThresholdMinor).toBe('0');
    expect(DEMO_POLICY_SET.periodOpen).toBe(true);
  });

  it('resolveCoa reproduces the original closure semantics exactly', () => {
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1' })).toBe('DigitalAssets');
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L2' })).toBe('AccountsReceivable');
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'L1' })).toBe('AccountsPayable');
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'L9' })).toBe('DigitalAssets');
    expect(resolveCoa({ eventType: 'UNKNOWN', leg: 'L1' })).toBe(DEMO_DEFAULT_ACCOUNT);
  });

  it('buildCoaMapping yields a CoaMapping whose resolve matches resolveCoa', () => {
    const m = buildCoaMapping();
    expect(m.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT' as any, leg: 'L1', coinType: 'X' })).toBe('DigitalAssets');
  });

  it('DEMO_COA_RULES is JSON-serializable (no functions)', () => {
    expect(() => JSON.stringify({ rules: DEMO_COA_RULES, default: DEMO_DEFAULT_ACCOUNT })).not.toThrow();
    expect(JSON.parse(JSON.stringify(DEMO_COA_RULES))).toEqual(DEMO_COA_RULES);
  });
});
