// services/api/test/scaffold.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const baseEnv = {
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'https://grpc',
  ANCHOR_PACKAGE_ID: '0xpkg', ANCHOR_ORIGINAL_PACKAGE_ID: '0xpkg',
  ENTITY_ID: 'acme:pilot-001', ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm1', AI_MODEL_COPILOT: 'm2',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
};

describe('loadConfig', () => {
  it('parses env into typed config with numeric threshold + port', () => {
    const c = loadConfig(baseEnv);
    expect(c.port).toBe(8787);
    expect(c.aiConfidenceThreshold).toBeCloseTo(0.85);
    expect(c.entityId).toBe('acme:pilot-001');
  });
  it('throws when a required key is missing', () => {
    const { GEMINI_API_KEY, ...rest } = baseEnv;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrowError(/GEMINI_API_KEY/);
  });
  it('throws when threshold is out of [0,1]', () => {
    expect(() => loadConfig({ ...baseEnv, AI_CONFIDENCE_THRESHOLD: '1.5' })).toThrowError(/AI_CONFIDENCE_THRESHOLD/);
  });
});
