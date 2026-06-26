import { buildApp, inject, assert, expectErr } from './harness.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

export async function run(): Promise<void> {
  const { app } = await buildApp();
  const kp = Ed25519Keypair.generate();
  const wallet = kp.toSuiAddress();

  // 1) happy: challenge → sign message → verify
  const ch = (await inject(app, 'POST', '/onboarding/challenge', { wallet })).body;
  assert(ch.nonce && ch.message, `challenge missing nonce/message: ${JSON.stringify(ch)}`);
  const sig = (await kp.signPersonalMessage(new TextEncoder().encode(ch.message))).signature;
  const ok = await inject(app, 'POST', '/onboarding/verify', { wallet, nonce: ch.nonce, signature: sig });
  assert(ok.status === 200 && ok.body.verdict === 'VERIFIED', `verify happy failed: ${JSON.stringify(ok.body)}`);
  assert(ok.body.attestation?.wallet, 'no attestation returned');

  // 2) BAD_SIGNATURE
  const ch2 = (await inject(app, 'POST', '/onboarding/challenge', { wallet })).body;
  const bad = await inject(app, 'POST', '/onboarding/verify',
    { wallet, nonce: ch2.nonce, signature: 'AA' + sig.slice(2) });
  expectErr(bad, 422, 'BAD_SIGNATURE');

  // 3) ADDRESS_MISMATCH — valid sig from a different key than claimed wallet
  const other = Ed25519Keypair.generate();
  const ch3 = (await inject(app, 'POST', '/onboarding/challenge', { wallet })).body;
  const otherSig = (await other.signPersonalMessage(new TextEncoder().encode(ch3.message))).signature;
  const mism = await inject(app, 'POST', '/onboarding/verify', { wallet, nonce: ch3.nonce, signature: otherSig });
  expectErr(mism, 422, 'ADDRESS_MISMATCH');

  // 4) CHALLENGE_INVALID — replay the already-consumed happy nonce
  const replay = await inject(app, 'POST', '/onboarding/verify', { wallet, nonce: ch.nonce, signature: sig });
  expectErr(replay, 422, 'CHALLENGE_INVALID');
  console.log('(S6) onboarding verify happy + BAD_SIGNATURE + ADDRESS_MISMATCH + replay');
}
