import { Pool } from 'pg';
import { SuiClient } from '@mysten/sui/client';
import { SuiJsonRpcSource } from '../source/SuiJsonRpcSource.js';
import { PostgresRepository } from '../repo/PostgresRepository.js';
import { ingestEntity } from '../ingest/ingestEntity.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const address = arg('address');
  const entityRef = arg('entity') ?? 'pilot';
  if (!address) throw new Error('usage: ingest --address 0x.. [--entity name]');

  const rpcUrl = process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';
  const expectedChainId = process.env.EXPECTED_CHAIN_IDENTIFIER;
  if (!expectedChainId) throw new Error('EXPECTED_CHAIN_IDENTIFIER is required (network guard, F3)');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const source = new SuiJsonRpcSource(new SuiClient({ url: rpcUrl }) as never, expectedChainId);
  const guard = await source.describe();           // startup network guard
  console.log(`ingesting from chain=${guard.chainIdentifier} epoch=${guard.epoch}`);

  const repo = new PostgresRepository(new Pool({ connectionString: process.env.DATABASE_URL }));
  const result = await ingestEntity({ source, repo, entityRef, address });
  console.log(JSON.stringify(result));
}

main().catch((e) => { console.error(e); process.exit(1); });
