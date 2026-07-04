import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.js';
import { createMemoryClient } from '../src/triage/memory/factory.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { LocalMemory } from '../src/triage/memory/localMemory.js';
import { MemwalMemory } from '../src/triage/memory/memwalMemory.js';
import type { ApiConfig } from '../src/config.js';

function cfgWith(mode: 'off' | 'local' | 'memwal'): ApiConfig {
  return {
    memory: {
      mode, namespacePrefix: 'triage', recallLimit: 5, recallMaxDistance: null, recallTimeoutMs: 3000,
      privateKey: mode === 'memwal' ? 'k' : undefined, accountId: mode === 'memwal' ? 'a' : undefined,
    },
  } as ApiConfig;
}

describe('createMemoryClient', () => {
  it('off → OffMemory', () => {
    expect(createMemoryClient(cfgWith('off'), openDb(':memory:'))).toBeInstanceOf(OffMemory);
  });
  it('local → LocalMemory', () => {
    expect(createMemoryClient(cfgWith('local'), openDb(':memory:'))).toBeInstanceOf(LocalMemory);
  });
  it('memwal → MemwalMemory', () => {
    expect(createMemoryClient(cfgWith('memwal'), openDb(':memory:'))).toBeInstanceOf(MemwalMemory);
  });
});
