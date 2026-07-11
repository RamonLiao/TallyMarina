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
    // Note: `app@org::tok::TOK` fails isValidStructTag on its own (invalid separator), so
    // this case alone does not prove the named-package guard is load-bearing — see the two
    // cases below for that.
    expect(() => canonicalCoinType('app@org::tok::TOK')).toThrow(CoinTypeError);
    try { canonicalCoinType('app@org::tok::TOK'); } catch (e) {
      expect((e as CoinTypeError).code).toBe('NAMED_PACKAGE_UNSUPPORTED');
    }
  });

  it('rejects a top-level SuiNS named package that passes isValidStructTag', () => {
    // WHY: this is the guard's only real defense line. `app.sui/tok::x::Y` is a *valid*
    // struct tag per isValidStructTag, and normalizeStructTag leaves it byte-for-byte
    // unchanged (it does not resolve MVR aliases). If the named-package guard is removed,
    // this input sails through canonicalCoinType and getCoinMetadata's mvr.resolveType()
    // silently resolves it to a different key than the one stored in asset_registry.
    expect(() => canonicalCoinType('app.sui/tok::x::Y')).toThrow(CoinTypeError);
    try { canonicalCoinType('app.sui/tok::x::Y'); } catch (e) {
      expect((e as CoinTypeError).code).toBe('NAMED_PACKAGE_UNSUPPORTED');
    }
  });

  it('rejects a SuiNS named package nested inside a generic type param', () => {
    // WHY: a top-level-only address check (e.g. slicing up to the first '::') only sees the
    // outer `0x2` in `0x2::coin::Coin<app.sui/tok::x::Y>` and never inspects the inner type
    // param, so the named package inside the generic sails through unguarded. The SDK's
    // getCoinMetadata resolves that inner alias via mvr.resolveType() (grpc/core.mjs:148)
    // while normalizeStructTag leaves it verbatim — same "two rows, one asset" failure mode,
    // just one level deeper. This is the guard's only defense against that depth.
    expect(() => canonicalCoinType('0x2::coin::Coin<app.sui/tok::x::Y>')).toThrow(CoinTypeError);
    try { canonicalCoinType('0x2::coin::Coin<app.sui/tok::x::Y>'); } catch (e) {
      expect((e as CoinTypeError).code).toBe('NAMED_PACKAGE_UNSUPPORTED');
    }
  });

  it('accepts an uppercase 0X hex prefix without misreporting it as a named package', () => {
    // WHY: HEX_ADDRESS used to be case-sensitive on the 'x' in '0x', so a legal struct tag
    // like '0X2::sui::SUI' (isValidStructTag === true, normalizes to the same SUI long form)
    // was wrongly rejected as NAMED_PACKAGE_UNSUPPORTED — a lying error code on a valid input.
    expect(canonicalCoinType('0X2::sui::SUI')).toBe(SUI_LONG);
  });

  it('rejects malformed struct tags', () => {
    for (const bad of ['', 'sui::SUI', '0x2::sui', 'not a type', '0x2::sui::SUI::extra']) {
      expect(() => canonicalCoinType(bad)).toThrow(CoinTypeError);
    }
  });

  it('rejects a non-string input at runtime', () => {
    expect(() => canonicalCoinType(undefined as unknown as string)).toThrow(CoinTypeError);
  });

  it('rejects a SuiNS named package hidden inside a vector<...> type param', () => {
    // WHY: parseStructTag does not recurse into `vector<...>` — it returns the whole thing
    // as one opaque string (e.g. "vector<app.sui/tok::x::Y>"), so the old guard's
    // `typeof param !== 'string'` check treated it as a harmless primitive and let it through.
    // isValidStructTag also returns true for this input and normalizeStructTag leaves the
    // named package byte-for-byte unchanged, so this was a real "two rows, one asset" hole.
    expect(() => canonicalCoinType('0x2::coin::Coin<vector<app.sui/tok::x::Y>>')).toThrow(CoinTypeError);
    try { canonicalCoinType('0x2::coin::Coin<vector<app.sui/tok::x::Y>>'); } catch (e) {
      expect((e as CoinTypeError).code).toBe('INVALID_COIN_TYPE');
    }
  });

  it('does not regress legitimate compound-generic coin types', () => {
    // WHY: the vector<...> guard above matches on `::` inside a string type param. Legal
    // struct-typed generics like `Table<u64, 0x2::sui::SUI>` come back from parseStructTag as
    // nested StructTag objects (not strings), and `Option<vector<u8>>`'s inner "vector<u8>"
    // string param has no `::` in it — neither must trip the new rejection.
    expect(canonicalCoinType('0x2::coin::Coin<0x2::sui::SUI>')).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>',
    );
    expect(canonicalCoinType('0x2::table::Table<u64, 0x2::sui::SUI>')).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000002::table::Table<u64,0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>',
    );
    expect(canonicalCoinType('0x1::option::Option<vector<u8>>')).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001::option::Option<vector<u8>>',
    );
  });
});
