import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { seed } from './store/seed.js';
import { registerRoutes } from './http/routes.js';
import { makeGeminiClient } from './ai/geminiClient.js';
import { makeEntityMutex } from '@subledger/anchor-svc';
import { makeGrpcAdapter } from './grpcClient.js';
import type { FixtureBundle } from './deps/ingestion.js';

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

const { adapter } = makeGrpcAdapter(cfg);
const ai = makeGeminiClient(cfg.geminiApiKey);
const mutex = makeEntityMutex();

const app = Fastify({ logger: true });
app.addHook('onRequest', async (_req, reply) => {
  reply.header('access-control-allow-origin', '*');
  reply.header('access-control-allow-headers', 'content-type');
});
app.options('/*', async (_req, reply) => reply.code(204).send());
registerRoutes(app, { db, cfg, classifyClient: ai, copilotClient: ai, anchorAdapter: adapter, mutex });

app.listen({ port: cfg.port, host: '0.0.0.0' })
  .then(() => app.log.info(`api on :${cfg.port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
