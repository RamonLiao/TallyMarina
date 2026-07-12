import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { seed } from './store/seed.js';
import { registerRoutes, DEFAULT_PERIOD } from './http/routes.js';
import { makeGeminiClient } from './ai/geminiClient.js';
import { makeEntityMutex } from '@subledger/anchor-svc';
import { makeGrpcAdapter } from './grpcClient.js';
import type { FixtureBundle } from './deps/ingestion.js';
import { makeTriageRunner, startTriageScheduler } from './triage/scheduler.js';
import { createMemoryClient } from './triage/memory/factory.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acme-pilot-001.events.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureBundle;
seed(db, {
  entityId: cfg.entityId,
  entityChainId: cfg.entityChainId,
  entityCapId: cfg.entityCapId,
  originalPackageId: cfg.anchorOriginalPackageId,
}, fixture);

const { grpc, adapter } = makeGrpcAdapter(cfg);
const ai = makeGeminiClient(cfg.geminiApiKey);
const mutex = makeEntityMutex();
const memory = createMemoryClient(cfg, db);
const triageRunner = makeTriageRunner({ db, cfg, client: ai, memory });
startTriageScheduler(triageRunner, cfg.triageIntervalMs, cfg.entityId, DEFAULT_PERIOD);

const app = Fastify({ logger: true });
const LOCALHOST_ORIGIN = /^https?:\/\/localhost(:\d+)?$/;
app.addHook('onRequest', async (req, reply) => {
  const origin = req.headers.origin;
  if (origin && LOCALHOST_ORIGIN.test(origin)) {
    reply.header('access-control-allow-origin', origin);
    reply.header('access-control-allow-headers', 'content-type');
    reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
});
app.options('/*', async (_req, reply) => reply.code(204).send());
registerRoutes(app, { db, cfg, classifyClient: ai, copilotClient: ai, anchorAdapter: adapter, grpc, mutex, triageRunner, memory });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => { void memory.close().finally(() => process.exit(0)); });
}

memory.probe()
  .then(() => app.listen({ port: cfg.port, host: '0.0.0.0' }))
  .then(() => app.log.info(`api on :${cfg.port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
