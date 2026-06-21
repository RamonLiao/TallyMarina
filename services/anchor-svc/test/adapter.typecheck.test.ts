import { describe, it, expect } from 'vitest';
import { SuiChainAdapter } from '../src/adapter/suiChainAdapter.js';

describe('SuiChainAdapter', () => {
  it('is constructible and satisfies the SuiChainPort shape', () => {
    expect(typeof SuiChainAdapter).toBe('function');
    // structural check only; real behavior is covered by the testnet e2e (Task 9).
    expect(SuiChainAdapter.prototype.execAnchor).toBeTypeOf('function');
    expect(SuiChainAdapter.prototype.getChainState).toBeTypeOf('function');
  });
});
