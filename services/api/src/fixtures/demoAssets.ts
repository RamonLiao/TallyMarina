/**
 * The explicit demo asset master list — declared, NOT derived from event payloads.
 *
 * Deriving the registry from a fixture's `assetDecimals` would be exactly the "infer the
 * master file from transactions" that spec D1 rejects; smuggling it into the seeder would
 * not make it not that. So the demo assets live here, in a file a reviewer can read.
 *
 * acme:pilot-001 holds exactly these four. `0xface::tok::TOK` belongs to the OTHER entity in
 * the recon fixture (opening-lot-recon-test:entity) and must not be seeded under acme.
 *
 * Only `0x2::sui::SUI` exists on chain. The other three are valid-but-nonexistent placeholder
 * coin types (`0x{beef,cafe,dead}` — real hex, unlike the original `0xusdc/…` which
 * canonicalCoinType rejects because u/s/d/c are not hex digits). The offline seeder registers
 * all four as source='manual'; the live `seed:assets` script (which has a chain fetcher) is
 * what promotes SUI to source='chain'.
 */
export interface DemoAsset {
  coinType: string;
  decimals: number;
  symbol: string;
  reason: string;
}

export const DEMO_ASSETS: readonly DemoAsset[] = [
  { coinType: '0x2::sui::SUI', decimals: 9, symbol: 'SUI', reason: 'demo seed — canonical SUI registered on the offline path' },
  { coinType: '0xbeef::usdc::USDC', decimals: 6, symbol: 'USDC', reason: 'demo placeholder coin type; no on-chain metadata' },
  { coinType: '0xcafe::weth::WETH', decimals: 8, symbol: 'WETH', reason: 'demo placeholder coin type; no on-chain metadata' },
  { coinType: '0xdead::usdt::USDT', decimals: 6, symbol: 'USDT', reason: 'demo placeholder coin type; no on-chain metadata' },
] as const;
