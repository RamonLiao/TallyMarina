import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

// A minimal valid base env; memory OFF by default.
function baseEnv(over: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PORT: '3000', DB_PATH: ':memory:', SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'x',
    ANCHOR_PACKAGE_ID: 'x', ANCHOR_ORIGINAL_PACKAGE_ID: 'x', ENTITY_ID: 'e', ENTITY_CHAIN_ID: 'c',
    ENTITY_CAP_ID: 'k', GEMINI_API_KEY: 'g', AI_MODEL_CLASSIFY: 'm', AI_MODEL_COPILOT: 'm',
    AI_CONFIDENCE_THRESHOLD: '0.7', EXPLORER_BASE: 'https://x', ...over,
  };
}

describe('memory config', () => {
  it('defaults to mode=off with no memory env', () => {
    expect(loadConfig(baseEnv()).memory.mode).toBe('off');
  });

  it('mode=memwal without MEMWAL_PRIVATE_KEY throws fail-loud', () => {
    expect(() => loadConfig(baseEnv({ TRIAGE_MEMORY_MODE: 'memwal', MEMWAL_ACCOUNT_ID: 'a' })))
      .toThrow(/MEMWAL_PRIVATE_KEY/);
  });

  it('mode=memwal without MEMWAL_ACCOUNT_ID throws fail-loud', () => {
    expect(() => loadConfig(baseEnv({ TRIAGE_MEMORY_MODE: 'memwal', MEMWAL_PRIVATE_KEY: 'k' })))
      .toThrow(/MEMWAL_ACCOUNT_ID/);
  });

  it('unknown mode throws', () => {
    expect(() => loadConfig(baseEnv({ TRIAGE_MEMORY_MODE: 'bogus' }))).toThrow(/TRIAGE_MEMORY_MODE/);
  });

  it('mode=local needs no memwal creds and parses defaults', () => {
    const m = loadConfig(baseEnv({ TRIAGE_MEMORY_MODE: 'local' })).memory;
    expect(m.mode).toBe('local');
    expect(m.recallLimit).toBe(5);
    expect(m.recallTimeoutMs).toBe(3000);
    expect(m.namespacePrefix).toBe('triage');
  });

  it('memwal mode with creds parses', () => {
    const m = loadConfig(baseEnv({ TRIAGE_MEMORY_MODE: 'memwal', MEMWAL_PRIVATE_KEY: 'k', MEMWAL_ACCOUNT_ID: 'a' })).memory;
    expect(m).toMatchObject({ mode: 'memwal', privateKey: 'k', accountId: 'a' });
  });
});
