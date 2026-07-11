import { Pool } from 'pg';
// JSON-RPC is permanently retired 2026-07-31 (spec §13.1). We ingest by
// scanning gRPC checkpoints and filtering locally, seeding the custom indexer.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiCheckpointGrpcSource } from '../source/SuiCheckpointGrpcSource.js';
import { PostgresRepository } from '../repo/PostgresRepository.js';
import { ingestEntity } from '../ingest/ingestEntity.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const address = arg('address');
  const entityRef = arg('entity') ?? 'pilot';
  const fromCheckpoint = arg('from-checkpoint');
  if (!address) throw new Error('usage: ingest --address 0x.. --from-checkpoint N [--entity name]');
  // Required on the first run (no repo cursor yet); resumes use the stored cursor.
  if (!fromCheckpoint) throw new Error('--from-checkpoint N is required on first run (checkpoint scan start, spec §13.1)');
  if (!/^\d+$/.test(fromCheckpoint)) throw new Error(`--from-checkpoint must be a non-negative integer, got: ${fromCheckpoint}`);

  const grpcUrl = process.env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443';
  const expectedChainId = process.env.EXPECTED_CHAIN_IDENTIFIER;
  if (!expectedChainId) throw new Error('EXPECTED_CHAIN_IDENTIFIER is required (network guard, F3)');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new SuiGrpcClient({
    network: (process.env.SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
    baseUrl: grpcUrl,
  });
  const source = new SuiCheckpointGrpcSource(client as never, expectedChainId, fromCheckpoint);
  const guard = await source.describe();           // startup network guard (must run before any scan)
  console.log(`ingesting from chain=${guard.chainIdentifier} epoch=${guard.epoch} startCheckpoint=${fromCheckpoint}`);

  const repo = new PostgresRepository(new Pool({ connectionString: process.env.DATABASE_URL }));
  const result = await ingestEntity({ source, repo, entityRef, address });
  console.log(JSON.stringify(result));
}

main().catch((e) => { console.error(e); process.exit(1); });
