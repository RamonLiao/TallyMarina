import { isValidStructTag, normalizeStructTag, parseStructTag } from '@mysten/sui/utils';

// Not exported by @mysten/sui/utils; mirror parseStructTag's return shape.
type StructTag = ReturnType<typeof parseStructTag>;

export class CoinTypeError extends Error {
  constructor(
    public readonly coinType: string,
    public readonly code: 'INVALID_COIN_TYPE' | 'NAMED_PACKAGE_UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'CoinTypeError';
  }
}

// A named (MVR) package address is anything in the type (at any nesting depth — including
// inside generic type params) that is not a hex address. normalizeStructTag leaves those
// verbatim while getCoinMetadata resolves them (mvr.resolveType()) — so a named type and its
// resolved type would key two rows for one asset. Reject at the door.
// Case-insensitive on the '0x'/'0X' prefix: '0X2::sui::SUI' is a legal struct tag and must not
// be misreported as a named package.
const HEX_ADDRESS = /^0[xX][0-9a-fA-F]{1,64}$/;

// Walks a parsed struct tag and every nested type param (parseStructTag recurses into
// generics, e.g. `0x2::coin::Coin<app.sui/tok::x::Y>`), rejecting the first non-hex address
// found at any depth. Primitive type params (u8, ...) come back as plain strings from
// parseStructTag and carry no address, so they're skipped — EXCEPT: parseStructTag does not
// recurse into `vector<...>`, it returns the whole thing as one string (e.g.
// `"vector<app.sui/tok::x::Y>"`), so a named package hidden inside a vector type param would
// slip past this walk undetected. We can't safely re-parse that string here (parseStructTag
// only handles struct tags, not `vector<T>` syntax), so any string type param containing `::`
// is rejected outright as INVALID_COIN_TYPE: a legitimate coin type's phantom type params are
// never vector-wrapped structs, so this cannot reject a real coin type, and it closes the gap
// fail-closed instead of attempting a fragile secondary parse.
function assertNoNamedPackage(raw: string, tag: StructTag): void {
  if (!HEX_ADDRESS.test(tag.address)) {
    throw new CoinTypeError(raw, 'NAMED_PACKAGE_UNSUPPORTED',
      `named packages are not supported; use the resolved 0x… address: ${raw}`);
  }
  for (const param of tag.typeParams) {
    if (typeof param !== 'string') {
      assertNoNamedPackage(raw, param);
    } else if (param.includes('::')) {
      throw new CoinTypeError(raw, 'INVALID_COIN_TYPE',
        `unsupported compound type param (cannot verify no named package is nested inside): ${param} in ${raw}`);
    }
  }
}

export function canonicalCoinType(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new CoinTypeError(String(raw), 'INVALID_COIN_TYPE', `coinType must be a non-empty string`);
  }
  let parsed: StructTag;
  try {
    parsed = parseStructTag(raw);
  } catch {
    throw new CoinTypeError(raw, 'INVALID_COIN_TYPE', `not a valid coin type: ${raw}`);
  }
  assertNoNamedPackage(raw, parsed);
  if (!isValidStructTag(raw)) {
    throw new CoinTypeError(raw, 'INVALID_COIN_TYPE', `not a valid coin type: ${raw}`);
  }
  return normalizeStructTag(raw);
}
