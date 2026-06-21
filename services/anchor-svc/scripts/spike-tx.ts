import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
// NOTE: keypair loading is environment-specific. Simplest: export a base64
// secret to SUI_PRIVATE_KEY and use Ed25519Keypair.fromSecretKey.
const client = new SuiClient({ url: getFullnodeUrl('testnet') });
const kp = Ed25519Keypair.fromSecretKey(process.env.SUI_PRIVATE_KEY!);
const tx = new Transaction();
const [coin] = tx.splitCoins(tx.gas, [1]);
tx.transferObjects([coin], kp.toSuiAddress());
const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEffects: true } });
console.log('digest', res.digest, 'status', res.effects?.status);
