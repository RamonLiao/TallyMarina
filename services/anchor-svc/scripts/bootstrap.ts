/**
 * One-time per-entity bootstrap (Task 9): create an EntityAnchorChain on testnet.
 *
 * Usage:
 *   SUI_PK=suiprivkey1... PACKAGE_ID=0x... ENTITY_ID=acme:pilot-001 \
 *   npx tsx scripts/bootstrap.ts
 *
 * Prints the created EntityAnchorChain (shared) and AnchorCap (owned) object ids
 * to populate the EntityRegistry. Mirrors the verified CLI flow:
 *   sui client call --package <PKG> --module audit_anchor --function create_chain \
 *     --args "[<entity_ref bytes>]"
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { deriveEntityRef } from '../src/core/entityRef.js';

const PK = process.env.SUI_PK!;
const PACKAGE_ID = process.env.PACKAGE_ID!;
const ENTITY_ID = process.env.ENTITY_ID!;

const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet') });
const kp = Ed25519Keypair.fromSecretKey(PK);
const ref = deriveEntityRef(ENTITY_ID);

const tx = new Transaction();
tx.moveCall({
  target: `${PACKAGE_ID}::audit_anchor::create_chain`,
  arguments: [tx.pure.vector('u8', Array.from(ref))],
});

const res = await client.core.signAndExecuteTransaction({
  transaction: tx,
  signer: kp,
  include: { effects: true },
});

if (res.$kind !== 'Transaction') {
  throw new Error(`create_chain failed: ${JSON.stringify(res)}`);
}
console.log('create_chain digest', res.Transaction.digest);
console.log('Read the created objects with:');
console.log(`  sui client tx-block ${res.Transaction.digest}`);
console.log('Populate EntityRegistry with the EntityAnchorChain (shared) + AnchorCap (owned) ids.');
