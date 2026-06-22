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
const ORIGINAL_PACKAGE_ID = '0xafc87017beab87bd4b0bad129d3aa5c5ed4a7a20fef888f458916b8477ea9c0d';
const ENTITY_ID = 'acme:pilot-001';
const EXPECTED_CHAIN = '0x451114f9db3b6226bc8c3dd79a21796408a75eb983a6701d345e449f25b4162f';
const EXPECTED_CAP = '0x266e7c8ea0b27ad52080074c9f6c1f73ec8a6ea9dd9a68d310b7cf56262dfba9';
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
