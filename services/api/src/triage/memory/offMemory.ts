import type { MemoryClient, MemoryHit } from './types.js';

/** Round-1 behavior: memory is fully disabled. */
export class OffMemory implements MemoryClient {
  async recall(): Promise<MemoryHit[]> { return []; }
  async remember(): Promise<void> { /* noop */ }
  async probe(): Promise<void> { /* noop */ }
  async close(): Promise<void> { /* noop */ }
}
