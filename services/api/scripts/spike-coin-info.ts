/**
 * spike-coin-info.ts — ONE-TIME live verification spike (Task 12b).
 *
 * Verifies the real shape of stateService.getCoinInfo() against testnet, because the codebase's
 * current confidence rests on type declarations + hand-decoded proto reading, not a live call.
 * Read-only, no private key required.
 *
 * Run: cd services/api && set -a && . ./.env && set +a && npx tsx scripts/spike-coin-info.ts
 */
import { makeGrpcClient } from '../src/grpcClient.js';
import { loadConfig } from '../src/config.js';
import { makeGrpcCoinInfoFetcher } from '../src/assets/register.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const grpc = makeGrpcClient(cfg);

  const { response } = await grpc.stateService.getCoinInfo(
    { coinType: '0x2::sui::SUI' },
    { abort: AbortSignal.timeout(15000) },
  );

  console.log('--- full response.metadata dump ---');
  console.log(JSON.stringify(response.metadata, null, 2));

  const m = response.metadata as
    | { decimals?: number; symbol?: string; name?: string; id?: string; metadataCapState?: number; version?: unknown }
    | undefined;

  console.log('\n--- assertions ---');
  console.log('typeof decimals:', typeof m?.decimals, 'value:', m?.decimals);
  console.assert(m?.decimals === 9, `EXPECTED decimals===9 (number), got ${JSON.stringify(m?.decimals)} (${typeof m?.decimals})`);

  console.log('id present:', m?.id !== undefined, 'value:', m?.id);
  console.assert(m?.id !== undefined, 'EXPECTED metadata.id to be present');

  console.log('metadataCapState runtime value:', m?.metadataCapState, 'typeof:', typeof m?.metadataCapState);

  console.log('version field present on metadata object:', 'version' in (m ?? {}));
  console.assert(!('version' in (m ?? {})), 'EXPECTED no version field on CoinMetadata (spec D16 assumption)');

  // --- Task 12b Finding 1: probe a coin that is NOT on chain ---------------------------------
  // A legal struct tag that does not exist on chain. We need the REAL error shape to tell
  // "this coin has no metadata" (must → return null → manual branch) apart from a transport
  // failure (must → throw ChainUnreachableError). Do NOT trust type declarations here.
  const FAKE = '0xbeef::usdc::USDC';
  console.log(`\n--- probing a non-existent coin: ${FAKE} ---`);
  try {
    const { response: r2 } = await grpc.stateService.getCoinInfo(
      { coinType: FAKE },
      { abort: AbortSignal.timeout(15000) },
    );
    console.log('NO THROW. response.metadata:', JSON.stringify(r2.metadata));
    console.log('response.metadata === undefined:', r2.metadata === undefined);
  } catch (e) {
    const err = e as Record<string, unknown> & Error;
    console.log('THREW. constructor.name:', err?.constructor?.name);
    console.log('err.code:', (err as { code?: unknown }).code, 'typeof:', typeof (err as { code?: unknown }).code);
    console.log('err.message:', err?.message);
    console.log('Object.keys(err):', JSON.stringify(Object.keys(err ?? {})));
    console.log('err.name:', err?.name);
    try { console.log('JSON.stringify(err):', JSON.stringify(err)); } catch { console.log('JSON.stringify(err): <unserialisable>'); }
    // Dump every own property including non-enumerable ones.
    console.log('getOwnPropertyNames:', JSON.stringify(Object.getOwnPropertyNames(err ?? {})));
    for (const k of Object.getOwnPropertyNames(err ?? {})) {
      console.log(`  [${k}] =`, JSON.stringify((err as Record<string, unknown>)[k]));
    }
  }

  // --- prove the FIX: makeGrpcCoinInfoFetcher must convert that NOT_FOUND throw into null ---------
  console.log(`\n--- makeGrpcCoinInfoFetcher(${FAKE}) — expecting null, not a throw ---`);
  const fetcher = makeGrpcCoinInfoFetcher(grpc, 15000);
  const fakeResult = await fetcher.getCoinInfo(FAKE);
  console.log('fetcher.getCoinInfo(fake) =>', JSON.stringify(fakeResult));
  console.assert(fakeResult === null, `EXPECTED null (→ manual branch), got ${JSON.stringify(fakeResult)}`);
  const realResult = await fetcher.getCoinInfo('0x2::sui::SUI');
  console.log('fetcher.getCoinInfo(SUI).decimals =>', realResult?.decimals);
  console.assert(realResult?.decimals === 9, 'EXPECTED SUI to still resolve decimals=9');

  console.log('\nSPIKE OK');
}

main().catch((e) => {
  console.error('SPIKE FAILED:', e);
  process.exit(1);
});
