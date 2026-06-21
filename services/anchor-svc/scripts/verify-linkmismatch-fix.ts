/**
 * Follow-up ① closing proof: with the re-read classification fix, the adapter must
 * throw LinkMismatchError for a real on-chain prev_link mismatch over JSON-RPC.
 * Non-mutating (assert aborts before any state write).
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiChainAdapter } from '../src/adapter/suiChainAdapter.js';
import { LinkMismatchError } from '../src/domain/types.js';

const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet') });
const kp = Ed25519Keypair.fromSecretKey(process.env.SUI_PK!);
const adapter = new SuiChainAdapter(client.core, kp);
const CHAIN_ID = process.env.CHAIN_ID!;

const state = await adapter.getChainState(CHAIN_ID);
const wrongPrev = Uint8Array.from(state.latestLink);
wrongPrev[0] ^= 0xff; // guaranteed mismatch vs real head
const h32 = (b: number) => Uint8Array.from(Array(32).fill(b));

try {
  await adapter.execAnchor({
    packageId: process.env.PACKAGE_ID!, chainObjectId: CHAIN_ID, capObjectId: process.env.CAP_ID!,
    prevLink: wrongPrev,
    args: { manifestHash: h32(0xaa), merkleRoot: h32(0xbb), periodId: new TextEncoder().encode('PROBE'), supersedesSeq: 0n },
  });
  console.log('❌ FAIL: adapter did not throw');
  process.exit(1);
} catch (e) {
  if (e instanceof LinkMismatchError) {
    console.log('✅ PASS: adapter threw LinkMismatchError over JSON-RPC →', e.message);
  } else {
    console.log('❌ FAIL: threw', (e as Error).name, '-', (e as Error).message);
    process.exit(1);
  }
}
