import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { normalizeSuiAddress } from '@mysten/sui/utils';
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

let app: FastifyInstance;
const E = 'acme:pilot-001';
beforeEach(async () => {
  const db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme Pilot', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
  app = Fastify();
  registerRoutes(app, {
    db, cfg, classifyClient: stub, copilotClient: stub,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
  } as never);
  await app.ready();
});

describe('onboarding routes', () => {
  it('GET /onboarding/:id returns entity meta + sources with ownership state', async () => {
    const res = await app.inject({ method: 'GET', url: `/onboarding/${E}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entity.meta.functionalCurrency).toBe('USD');
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.every((s: { ownership: { verified: boolean } }) => s.ownership.verified === false)).toBe(true);
  });

  it('full challenge → sign → verify round-trip flips ownership to verified', async () => {
    const kp = new Ed25519Keypair();
    const wallet = kp.toSuiAddress();
    const ch = await app.inject({ method: 'POST', url: '/onboarding/challenge', payload: { wallet } });
    const { nonce, expiresAt } = ch.json();
    const bytes = encodeOwnershipMessage({ entityId: E, wallet, nonce, expiresAt });
    const { signature } = await kp.signPersonalMessage(bytes);
    const v = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet, nonce, signature, connectedAccount: wallet } });
    expect(v.statusCode).toBe(200);
    expect(v.json().verdict).toBe('VERIFIED');
    // wallet not a derived source → shows up as unlistedVerified
    const after = await app.inject({ method: 'GET', url: `/onboarding/${E}` });
    const u = after.json().unlistedVerified;
    expect(u.some((x: { wallet: string }) => x.wallet === normalizeSuiAddress(wallet))).toBe(true);
  });

  it('POST /onboarding/verify with mismatched connectedAccount → 400, no attestation written', async () => {
    const kp = new Ed25519Keypair();
    const wallet = kp.toSuiAddress();
    const otherKp = new Ed25519Keypair();
    const otherWallet = otherKp.toSuiAddress();
    const ch = await app.inject({ method: 'POST', url: '/onboarding/challenge', payload: { wallet } });
    const { nonce, expiresAt } = ch.json();
    const bytes = encodeOwnershipMessage({ entityId: E, wallet, nonce, expiresAt });
    const { signature } = await kp.signPersonalMessage(bytes);
    const v = await app.inject({
      method: 'POST', url: '/onboarding/verify',
      payload: { wallet, nonce, signature, connectedAccount: otherWallet },
    });
    expect(v.statusCode).toBe(400);
    expect(v.json().error.code).toBe('VALIDATION');
    // Confirm no attestation was written — wallet not in unlistedVerified
    const after = await app.inject({ method: 'GET', url: `/onboarding/${E}` });
    const u = after.json().unlistedVerified;
    expect(u.some((x: { wallet: string }) => x.wallet === normalizeSuiAddress(wallet))).toBe(false);
  });

  it('GET unknown entity → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/onboarding/nope' });
    expect(res.statusCode).toBe(404);
  });
});
