/**
 * Manual testnet e2e for anchor-svc (Task 9).
 *
 * Usage:
 *   SUI_PK=suiprivkey1... \
 *   PACKAGE_ID=0x... CHAIN_ID=0x... CAP_ID=0x... ENTITY_ID=acme:pilot-001 \
 *   npx tsx scripts/e2e.ts
 *
 * Drives the real SuiChainAdapter through anchorSnapshot:
 *   anchor #1 (supersedesSeq 0) -> expect seq 1, link != genesis
 *   anchor #2 same period (supersedesSeq 1, restatement) -> expect seq 2
 *
 * Client: JSON-RPC core API (client.core). If P126 disables JSON-RPC execution,
 * swap to SuiGrpcClient from '@mysten/sui/grpc' (same CoreClient interface).
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiChainAdapter } from '../src/adapter/suiChainAdapter.js';
import { anchorSnapshot } from '../src/anchorSnapshot.js';

const PK = process.env.SUI_PK!;
const PACKAGE_ID = process.env.PACKAGE_ID!;
const CHAIN_ID = process.env.CHAIN_ID!;
const CAP_ID = process.env.CAP_ID!;
const ENTITY_ID = process.env.ENTITY_ID!;

const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet') });
const kp = Ed25519Keypair.fromSecretKey(PK);
const adapter = new SuiChainAdapter(client.core, kp);
const registry = { [ENTITY_ID]: { chainObjectId: CHAIN_ID, capObjectId: CAP_ID } };
const deps = { port: adapter, registry, packageId: PACKAGE_ID };

const h32 = (b: number) => Array(32).fill(b).map((x) => x.toString(16).padStart(2, '0')).join('');

// Read current seq so the script is re-runnable: assert relative increments.
const start = (await adapter.getChainState(CHAIN_ID)).seq;
console.log('start seq', start);

const r1 = await anchorSnapshot(ENTITY_ID, { manifestHash: h32(1), merkleRoot: h32(2), periodId: '2026-Q2', supersedesSeq: 0 }, deps);
console.log('anchor#1 digest', r1.digest, 'seq', r1.seq);
if (r1.seq !== start + 1n) throw new Error(`expected seq ${start + 1n}, got ${r1.seq}`);

// Wait for the fullnode to index tx#1 so the owned AnchorCap's new version is
// visible before building tx#2 (avoids stale owned-object version on back-to-back txs).
await client.core.waitForTransaction({ digest: r1.digest });

const r2 = await anchorSnapshot(ENTITY_ID, { manifestHash: h32(3), merkleRoot: h32(4), periodId: '2026-Q2', supersedesSeq: 1 }, deps);
console.log('anchor#2 (restate) digest', r2.digest, 'seq', r2.seq);
if (r2.seq !== start + 2n) throw new Error(`expected seq ${start + 2n}, got ${r2.seq}`);

console.log('E2E OK — seq', start + 1n, 'then', start + 2n, '; link', Buffer.from(r2.link).toString('hex').slice(0, 16) + '...');
