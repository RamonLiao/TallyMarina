import type { Db } from '../store/db.js';
import type { ApiConfig } from '../config.js';
import type { GeminiClient } from '../ai/geminiClient.js';
import type { MemoryClient } from './memory/types.js';
import { runTriageOnce, type TriageRunSummary } from './agent.js';

export interface TriageRunner {
  isRunning(): boolean;
  /** Throws Error('TRIAGE_BUSY') if a run is already in flight (skip-if-busy, not queue —
   *  deps.mutex.run would queue ticks, which is the wrong semantic for a poller). */
  runOnce(entityId: string, periodId: string): Promise<TriageRunSummary>;
}

export function makeTriageRunner(deps: { db: Db; cfg: ApiConfig; client: GeminiClient; memory: MemoryClient }): TriageRunner {
  let running = false;
  return {
    isRunning: () => running,
    async runOnce(entityId: string, periodId: string): Promise<TriageRunSummary> {
      if (running) throw new Error('TRIAGE_BUSY');
      running = true;
      try {
        return await runTriageOnce(deps, entityId, periodId);
      } finally {
        running = false;
      }
    },
  };
}

export function startTriageScheduler(runner: TriageRunner, intervalMs: number, entityId: string, periodId: string): () => void {
  if (intervalMs <= 0) return () => {};
  const timer = setInterval(() => {
    runner.runOnce(entityId, periodId).catch((err: Error) => {
      if (err.message !== 'TRIAGE_BUSY') console.error(`triage scheduler: ${err.message}`);
    });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
