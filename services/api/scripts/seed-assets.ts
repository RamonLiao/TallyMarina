/**
 * Explicit demo asset seeding for an EXISTING db — NOT a migration.
 *
 * The registry is master data; deriving it from existing event payloads would be exactly the
 * "infer the master file from transactions" that spec D1 rejects, smuggled in through a
 * migration. So the demo assets are declared in src/fixtures/demoAssets.ts, a file a reviewer
 * can read, and this script registers them through the real registerAsset() path.
 *
 * Unlike the offline server-start seeder (store/seed.ts), this script HAS a chain fetcher: it
 * verifies 0x2::sui::SUI against on-chain metadata and registers it source='chain'. The other
 * three are valid-but-nonexistent placeholder coin types with no on-chain metadata, so they
 * register source='manual' — which is exactly what the export and manifest will disclose.
 *
 * Run with the api env loaded, e.g.:
 *   cd services/api && set -a && . ./.env && set +a && npm run seed:assets
 */
import { openDb } from '../src/store/db.js';
import { registerAsset, makeGrpcCoinInfoFetcher, type CoinInfoFetcher } from '../src/assets/register.js';
import { makeGrpcClient } from '../src/grpcClient.js';
import { loadConfig } from '../src/config.js';
import { DEMO_ASSETS } from '../src/fixtures/demoAssets.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  const fetcher: CoinInfoFetcher = makeGrpcCoinInfoFetcher(makeGrpcClient(cfg), 8000);
  for (const a of DEMO_ASSETS) {
    const { status, row } = await registerAsset(db, fetcher, {
      entityId: cfg.entityId, ...a, actor: 'seed-assets', now: new Date().toISOString(),
    });
    console.log(`${status} ${row.coinType} decimals=${row.decimals} source=${row.source}`);
  }
}
void main();
