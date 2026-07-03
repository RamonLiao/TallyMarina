/**
 * Real-chain check (per follow-up ① discipline — no "verified-by-types only").
 * Runs buildRegistry once against the live testnet chain/cap from anchor-notes.md
 * and asserts the resolved ids match the known values.
 *
 * Usage:
 *   npx tsx scripts/verify-registry-builder.ts
 *
 * The script is read-only: it queries the live testnet for the AnchorCap owned
 * by the known OWNER address, resolves the entityId, and verifies the chain/cap
 * object ids match.
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildRegistry } from '../src/core/buildRegistry.js';
import { SuiChainAdapter } from '../src/adapter/suiChainAdapter.js';

// === Fill from anchor-notes.md ===
const ORIGINAL_PACKAGE_ID = '0x6aa2a0404013d3ea7840ab510420b9a1cde98cd20ad8fb54e32b0bbc9e8eb12f';
const ENTITY_ID = 'acme:pilot-001';
const EXPECTED_CHAIN = '0x4194290ec2e4d28617f7cae463ebfb4e37f173ed7b06b495cf203e015d1de869';
const EXPECTED_CAP = '0xaa1f65d8a2238ec0012d14413ee069207fa493274a71c53129a322489c8e8a73';
const OWNER = '0x1509b5fdf09296b2cf749a710e36da06f5693ccd5b2144ad643b3a895abcbc4c';  // address holding the AnchorCap (verified on-chain)
// =================================

async function main() {
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet') });

  // Throwaway keypair for the (unused-for-reads) signer slot
  const kp = Ed25519Keypair.generate();
  const adapter = new SuiChainAdapter(client.core, kp);

  const reg = await buildRegistry([ENTITY_ID], OWNER, ORIGINAL_PACKAGE_ID, adapter);
  const entry = reg[ENTITY_ID];
  if (!entry) throw new Error('entityId not resolved');
  if (entry.chainObjectId !== EXPECTED_CHAIN) {
    throw new Error(`chain mismatch: got ${entry.chainObjectId}, want ${EXPECTED_CHAIN}`);
  }
  if (entry.capObjectId !== EXPECTED_CAP) {
    throw new Error(`cap mismatch: got ${entry.capObjectId}, want ${EXPECTED_CAP}`);
  }
  console.log('OK: buildRegistry resolved', ENTITY_ID, '→', entry);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
