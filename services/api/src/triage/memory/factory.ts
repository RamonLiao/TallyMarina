import { MemWal } from '@mysten-incubation/memwal';
import type { ApiConfig } from '../../config.js';
import type { Db } from '../../store/db.js';
import type { MemoryClient } from './types.js';
import { OffMemory } from './offMemory.js';
import { LocalMemory } from './localMemory.js';
import { MemwalMemory, type MemWalLike } from './memwalMemory.js';

export function createMemoryClient(cfg: ApiConfig, db: Db): MemoryClient {
  const m = cfg.memory;
  if (m.mode === 'off') return new OffMemory();
  const local = new LocalMemory(db, m.recallLimit);
  if (m.mode === 'local') return local;
  // memwal: creds guaranteed present by loadConfig fail-loud (config.ts).
  return new MemwalMemory({
    fallback: local,
    cfg: m,
    createMemWal: (namespace) => MemWal.create({
      key: m.privateKey!, accountId: m.accountId!, namespace, serverUrl: m.serverUrl,
    }) as unknown as MemWalLike,
  });
}
