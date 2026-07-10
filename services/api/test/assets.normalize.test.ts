import { describe, it, expect } from 'vitest';
import { canonicalCoinType, CoinTypeError } from '../src/assets/normalize.js';

const SUI_LONG = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

describe('canonicalCoinType', () => {
  it('collapses the short and long address forms of one asset to one key', () => {
    // WHY: two spellings => two registry rows => one asset with two decimals.
    expect(canonicalCoinType('0x2::sui::SUI')).toBe(SUI_LONG);
    expect(canonicalCoinType(SUI_LONG)).toBe(SUI_LONG);
  });

  it('is idempotent', () => {
    expect(canonicalCoinType(canonicalCoinType('0x2::sui::SUI'))).toBe(SUI_LONG);
  });

  it('rejects MVR named packages', () => {
    // WHY: getCoinMetadata resolves the alias internally (grpc/core.mjs:148) but
    // normalizeStructTag does not (utils/sui-types.mjs:76). The fetch and the
    // registry key would disagree, producing two rows for one asset.
    expect(() => canonicalCoinType('app@org::tok::TOK')).toThrow(CoinTypeError);
    try { canonicalCoinType('app@org::tok::TOK'); } catch (e) {
      expect((e as CoinTypeError).code).toBe('NAMED_PACKAGE_UNSUPPORTED');
    }
  });

  it('rejects malformed struct tags', () => {
    for (const bad of ['', 'sui::SUI', '0x2::sui', 'not a type', '0x2::sui::SUI::extra']) {
      expect(() => canonicalCoinType(bad)).toThrow(CoinTypeError);
    }
  });

  it('rejects a non-string input at runtime', () => {
    expect(() => canonicalCoinType(undefined as unknown as string)).toThrow(CoinTypeError);
  });
});
