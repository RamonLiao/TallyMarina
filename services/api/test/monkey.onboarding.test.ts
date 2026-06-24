// services/api/test/monkey.onboarding.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { openDb } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { registerRoutes } from '../src/http/routes.js';
import { loadConfig } from '../src/config.js';
import { encodeOwnershipMessage } from '../src/onboarding/message.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';

const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'https://grpc', ANCHOR_PACKAGE_ID: '0xpkg',
  ANCHOR_ORIGINAL_PACKAGE_ID: '0xpkg', ENTITY_ID: 'acme:pilot-001',
  ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm1', AI_MODEL_COPILOT: 'm2',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});
const stub: GeminiClient = { async generateJson() { return {} as never; } };
const E = 'acme:pilot-001';
let app: FastifyInstance;
beforeEach(async () => {
  const db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
  app = Fastify();
  registerRoutes(app, { db, cfg, classifyClient: stub, copilotClient: stub, anchorAdapter: null as never, mutex: { run: (_k: string, fn: () => Promise<never>) => fn() } } as never);
  await app.ready();
});

async function freshSig() {
  const kp = new Ed25519Keypair();
  const wallet = kp.toSuiAddress();
  const { nonce, expiresAt } = (await app.inject({ method: 'POST', url: '/onboarding/challenge', payload: { wallet } })).json();
  const bytes = encodeOwnershipMessage({ entityId: E, wallet, nonce, expiresAt });
  const { signature } = await kp.signPersonalMessage(bytes);
  return { wallet, nonce, signature };
}

describe('monkey: onboarding verify', () => {
  it('replay of the same signature twice → 2nd is 422', async () => {
    const { wallet, nonce, signature } = await freshSig();
    const first = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet, nonce, signature, connectedAccount: wallet } });
    const second = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet, nonce, signature, connectedAccount: wallet } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(422);
  });

  it('cross-wallet nonce swap: A nonce + B signature → 422, no attestation', async () => {
    const a = await freshSig();
    const b = await freshSig();
    const res = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet: a.wallet, nonce: a.nonce, signature: b.signature, connectedAccount: a.wallet } });
    expect(res.statusCode).toBe(422);
  });

  it('forged message: client cannot influence verification (no message field accepted)', async () => {
    const { wallet, nonce, signature } = await freshSig();
    // attacker also passes a bogus "message" — server must ignore it and still verify against rebuilt bytes
    const res = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet, nonce, signature, connectedAccount: wallet, message: 'I OWN EVERYTHING' } });
    expect(res.statusCode).toBe(200); // still valid because server rebuilds; bogus field ignored
  });

  it('garbage signature → 422 BAD_SIGNATURE not 500', async () => {
    const { wallet, nonce } = await freshSig();
    const res = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet, nonce, signature: 'not-base64-!!', connectedAccount: wallet } });
    expect(res.statusCode).toBe(422);
  });

  it('oversized junk fields do not crash the server', async () => {
    const big = 'x'.repeat(100_000);
    const res = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet: big, nonce: big, signature: big, connectedAccount: big } });
    expect([400, 422]).toContain(res.statusCode);
  });
});
