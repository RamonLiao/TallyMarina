import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb, type Db } from '../../src/store/db.js';
import { seed } from '../../src/store/seed.js';
import { registerRoutes } from '../../src/http/routes.js';
import { loadConfig, type ApiConfig } from '../../src/config.js';
import type { GeminiClient } from '../../src/ai/geminiClient.js';
import { makeGeminiClient } from '../../src/ai/geminiClient.js';
import { makeEntityMutex } from '@subledger/anchor-svc';
import { makeGrpcAdapter } from '../../src/grpcClient.js';
import type { FixtureBundle } from '../../src/deps/ingestion.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'fixtures');

// Deterministic stub: high-confidence AUTO for every event (control scenarios don't need real AI).
export const stubClassify: GeminiClient = {
  async generateJson() {
    return { eventType: 'DIGITAL_ASSET_RECEIPT', economicPurpose: 'TRADING',
      counterparty: null, confidence: 0.95, reasoning: 'stub' } as never;
  },
};
// Stub that forces ONE event below threshold → NEEDS_REVIEW (for S2).
export function lowConfidenceOnce(): GeminiClient {
  let n = 0;
  return { async generateJson() {
    const low = n++ === 0;
    return { eventType: 'DIGITAL_ASSET_RECEIPT', economicPurpose: 'TRADING',
      counterparty: null, confidence: low ? 0.10 : 0.95, reasoning: 'stub' } as never;
  } };
}

export interface BuildOpts { realChain?: boolean; classifyClient?: GeminiClient; }

export async function buildApp(opts: BuildOpts = {}): Promise<{ app: FastifyInstance; db: Db; cfg: ApiConfig; grpc?: ReturnType<typeof makeGrpcAdapter> }> {
  const cfg = loadConfig(); // reads real env (.env) — needs GEMINI_API_KEY; SUI_* for realChain
  const db = openDb(':memory:');
  const fixture = JSON.parse(readFileSync(join(FIX, 'acme-pilot-001.events.json'), 'utf8')) as FixtureBundle;
  seed(db, { entityId: cfg.entityId, entityChainId: cfg.entityChainId,
    entityCapId: cfg.entityCapId, originalPackageId: cfg.anchorOriginalPackageId }, fixture);

  let anchorAdapter: unknown = null;
  let grpc: ReturnType<typeof makeGrpcAdapter> | undefined;
  if (opts.realChain) { grpc = makeGrpcAdapter(cfg); anchorAdapter = grpc.adapter; }

  const classifyClient = opts.classifyClient ?? stubClassify;
  const app = Fastify();
  registerRoutes(app, {
    db, cfg, classifyClient, copilotClient: stubClassify,
    anchorAdapter: anchorAdapter as never, mutex: makeEntityMutex(),
  });
  await app.ready();
  return { app, db, cfg, grpc };
}

export async function inject(app: FastifyInstance, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const opts = payload !== undefined ? { method, url, payload: payload as object } : { method, url };
  const res = await app.inject(opts);
  return { status: res.statusCode, body: res.json() as any };
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
export function expectErr(res: { status: number; body: any }, status: number, code: string) {
  assert(res.status === status, `expected HTTP ${status}, got ${res.status} (body=${JSON.stringify(res.body)})`);
  assert(res.body?.error?.code === code, `expected error code ${code}, got ${res.body?.error?.code}`);
}
export { makeGeminiClient };
