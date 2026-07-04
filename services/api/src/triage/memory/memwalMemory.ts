import type { MemoryConfig } from '../../config.js';
import type { MemoryClient, MemoryRecord, RecallFeatures, RecallOutcome } from './types.js';
import { renderMemoryRecord, MEMORY_HIT_TEXT_CAP, sanitizeForPrompt } from './format.js';

/** Minimal surface we use from @mysten-incubation/memwal — keeps the SDK churn to this one seam. */
export interface MemWalLike {
  recall(input: { query: string; limit: number; maxDistance?: number }): Promise<{ results: { text: string; distance?: number }[] }>;
  rememberAndWait(text: string): Promise<unknown>;
  compatibility(): Promise<unknown>;
  health(): Promise<unknown>;
  destroy(): void;
}

/** Timeout wrapper that also swallows the loser's late rejection (SUI review M1). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('memwal recall timeout')), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export class MemwalMemory implements MemoryClient {
  private readonly instances = new Map<string, MemWalLike>();
  constructor(private readonly deps: {
    createMemWal: (namespace: string) => MemWalLike;
    fallback: MemoryClient;
    cfg: MemoryConfig;
  }) {}

  private forEntity(entityId: string): MemWalLike {
    const ns = `${this.deps.cfg.namespacePrefix}:${entityId}`;
    let mw = this.instances.get(entityId);
    if (!mw) { mw = this.deps.createMemWal(ns); this.instances.set(entityId, mw); }
    return mw;
  }

  async recall(input: { entityId: string; query: string; features: RecallFeatures; limit: number }): Promise<RecallOutcome> {
    try {
      const mw = this.forEntity(input.entityId);
      const maxDistance = this.deps.cfg.recallMaxDistance ?? undefined;
      const res = await withTimeout(mw.recall({ query: input.query, limit: input.limit, maxDistance }), this.deps.cfg.recallTimeoutMs);
      // Bound both the prompt and the persisted recall_context (SUI review Fix 3): truncate
      // each hit's text at the same cap used by renderFewShotBlock.
      const hits = res.results.map((r) => ({ text: sanitizeForPrompt(r.text, MEMORY_HIT_TEXT_CAP), distance: r.distance }));
      return { hits, servedBy: 'memwal' };
    } catch (err) {
      console.warn(`memwal recall failed, fail-open to local: ${(err as Error).message}`);
      // Fail-open reports its OWN honest source: from memwal's perspective this was a
      // fallback, never 'memwal' and never whatever the fallback itself claims (SUI
      // review Fix 1) — recall_context must never lie about what actually served the query.
      const fb = await this.deps.fallback.recall(input);
      return { hits: fb.hits, servedBy: 'local-fallback' };
    }
  }

  async remember(input: { entityId: string; record: MemoryRecord }): Promise<void> {
    // Caller is fire-and-forget; a throw here is caught by the caller's .catch. No fallback write
    // (LocalMemory.remember is a no-op — the authoritative row already exists in triage_proposal).
    const mw = this.forEntity(input.entityId);
    await mw.rememberAndWait(renderMemoryRecord(input.record));
  }

  async probe(): Promise<void> {
    // Startup fail-loud: a dedicated probe instance exercises the dynamic seal/sui import + relayer.
    const mw = this.forEntity('__probe__');
    try {
      await mw.compatibility();
      await mw.health();
    } catch (err) {
      throw new Error(`memory probe failed (memwal peers/relayer unreachable): ${(err as Error).message}`);
    } finally {
      mw.destroy();
      this.instances.delete('__probe__');
    }
  }

  async close(): Promise<void> {
    for (const mw of this.instances.values()) {
      try { mw.destroy(); } catch { /* best-effort teardown */ }
    }
    this.instances.clear();
  }
}
