import { isValidStructTag, normalizeStructTag } from '@mysten/sui/utils';

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

// A named (MVR) package address is anything before the first '::' that is not a hex address.
// normalizeStructTag leaves those verbatim while getCoinMetadata resolves them — so a named
// type and its resolved type would key two rows for one asset. Reject at the door.
const HEX_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

export function canonicalCoinType(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new CoinTypeError(String(raw), 'INVALID_COIN_TYPE', `coinType must be a non-empty string`);
  }
  const addr = raw.slice(0, raw.indexOf('::'));
  if (raw.includes('::') && !HEX_ADDRESS.test(addr)) {
    throw new CoinTypeError(raw, 'NAMED_PACKAGE_UNSUPPORTED',
      `named packages are not supported; use the resolved 0x… address: ${raw}`);
  }
  if (!isValidStructTag(raw)) {
    throw new CoinTypeError(raw, 'INVALID_COIN_TYPE', `not a valid coin type: ${raw}`);
  }
  return normalizeStructTag(raw);
}
