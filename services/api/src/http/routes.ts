import type { FastifyInstance } from 'fastify';
import type { Db } from '../store/db.js';
import type { ApiConfig } from '../config.js';
import type { GeminiClient } from '../ai/geminiClient.js';
import type { SuiGrpcChainAdapter } from '@subledger/anchor-svc';
import { ApiError, toEnvelope } from './errors.js';
import { StateError } from '../store/stateMachine.js';
import { AnchorError } from '../deps/anchorSvc.js';
import { listEntities, getEntity } from '../store/entityStore.js';
import {
  listEvents, getEvent, listByStatus, setAiSuggestion, setDecision, markPosted, type EventRow,
} from '../store/eventStore.js';
import { insertJournalEntry, listJournal } from '../store/journalStore.js';
import { insertSnapshot, getSnapshot } from '../store/snapshotStore.js';
import { listAnchors } from '../store/anchorStore.js';
import { classifyEvent } from '../ai/classify.js';
import { reviewCopilot } from '../ai/copilot.js';
import { buildRuleInput } from './buildRuleInput.js';
import { evaluate, buildMerkle, leafHash, inclusionProof, type JournalEntry } from '../deps/rulesEngine.js';
import { buildSnapshot, InMemorySnapshotRepo } from '../deps/snapshotSvc.js';
import { prepareAnchor, confirmAnchor, type AnchorServiceDeps } from './anchorService.js';
import { SnapshotError } from '@subledger/snapshot-svc';

export interface RouteDeps {
  db: Db;
  cfg: ApiConfig;
  classifyClient: GeminiClient;
  copilotClient: GeminiClient;
  anchorAdapter: SuiGrpcChainAdapter;
  mutex: { run<T>(key: string, fn: () => Promise<T>): Promise<T> };
}

function eventDTO(e: EventRow) {
  const hasAi = e.aiEventType !== null || e.aiConfidence !== null;
  return {
    id: e.id, entityId: e.entityId, status: e.status,
    normalized: JSON.parse(e.rawJson) as unknown,
    ai: hasAi ? {
      eventType: e.aiEventType, purpose: e.aiPurpose, counterparty: e.aiCounterparty,
      confidence: e.aiConfidence, reasoning: e.aiReasoning,
    } : null,
    final: (e.finalEventType !== null || e.finalPurpose !== null)
      ? { eventType: e.finalEventType, purpose: e.finalPurpose } : null,
    routing: (e.status === 'AUTO' || e.status === 'NEEDS_REVIEW') ? e.status : null,
  };
}

function journalDTO(db: Db, entityId: string) {
  return listJournal(db, entityId).map((r) => ({
    id: r.id, eventId: r.eventId, idempotencyKey: r.idempotencyKey, leafHash: r.leafHash,
    je: JSON.parse(r.jeJson) as unknown,
  }));
}

function requireEntity(db: Db, id: string) {
  const e = getEntity(db, id);
  if (!e) throw new ApiError(404, 'ENTITY_NOT_FOUND', `no entity ${id}`);
  return e;
}

function requireEvent(db: Db, id: string): EventRow {
  const e = getEvent(db, id);
  if (!e) throw new ApiError(404, 'EVENT_NOT_FOUND', `no event ${id}`);
  return e;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, cfg } = deps;

  // Unified error envelope.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) return reply.code(err.statusCode).send(toEnvelope(err.code, err.message));
    if (err instanceof StateError) return reply.code(409).send(toEnvelope('ILLEGAL_TRANSITION', err.message));
    if (err instanceof SnapshotError) return reply.code(409).send(toEnvelope(err.code, err.message));
    if (err instanceof AnchorError) {
      const map: Record<string, number> = {
        ENTITY_REF_MISMATCH: 409, STALE_CAP: 409, BAD_HASH_LEN: 400, PERIOD_TOO_LONG: 400, SEQ_OUT_OF_RANGE: 400,
      };
      return reply.code(map[err.code] ?? 409).send(toEnvelope(err.code, err.message));
    }
    if ((err as { validation?: unknown }).validation) return reply.code(400).send(toEnvelope('VALIDATION', err.message));
    return reply.code(500).send(toEnvelope('INTERNAL', err.message));
  });

  // 1. GET /entities
  app.get('/entities', async () => ({
    entities: listEntities(db).map((e) => ({
      id: e.id, displayName: e.displayName, chainObjectId: e.chainObjectId,
      capObjectId: e.capObjectId, originalPackageId: e.originalPackageId,
    })),
  }));

  // 2. POST /entities/:id/ingest
  app.post<{ Params: { id: string } }>('/entities/:id/ingest', async (req) => {
    requireEntity(db, req.params.id);
    const events = listEvents(db, req.params.id);
    return { ingested: events.length, events: events.map(eventDTO) };
  });

  // 3. GET /entities/:id/events
  app.get<{ Params: { id: string } }>('/entities/:id/events', async (req) => {
    requireEntity(db, req.params.id);
    return { events: listEvents(db, req.params.id).map(eventDTO) };
  });

  // 4. POST /events/:id/classify
  app.post<{ Params: { id: string } }>('/events/:id/classify', async (req) => {
    const ev = requireEvent(db, req.params.id);
    const res = await classifyEvent(
      { rawJson: ev.rawJson },
      { client: deps.classifyClient, model: cfg.aiModelClassify, threshold: cfg.aiConfidenceThreshold },
    );
    setAiSuggestion(db, ev.id, {
      aiEventType: res.suggestion.eventType,
      aiPurpose: res.suggestion.economicPurpose,
      aiCounterparty: res.suggestion.counterparty,
      aiConfidence: res.suggestion.confidence,
      aiReasoning: res.suggestion.reasoning,
      nextStatus: res.routing,
    });
    return { event: eventDTO(getEvent(db, ev.id)!), degraded: res.degraded };
  });

  // 5. GET /entities/:id/review-queue
  app.get<{ Params: { id: string } }>('/entities/:id/review-queue', async (req) => {
    requireEntity(db, req.params.id);
    return { events: listByStatus(db, req.params.id, 'NEEDS_REVIEW').map(eventDTO) };
  });

  // 6. POST /reviews/:eventId/copilot
  app.post<{ Params: { eventId: string } }>('/reviews/:eventId/copilot', async (req) => {
    const ev = requireEvent(db, req.params.eventId);
    const advice = await reviewCopilot(
      { rawJson: ev.rawJson }, {},
      { client: deps.copilotClient, model: cfg.aiModelCopilot },
    );
    return { advice };
  });

  // 7. POST /reviews/:eventId/decide
  app.post<{ Params: { eventId: string }; Body: { finalEventType?: string; finalPurpose?: string } }>('/reviews/:eventId/decide', async (req) => {
    const ev = requireEvent(db, req.params.eventId);
    const b = req.body ?? {};
    if (!b.finalEventType || !b.finalPurpose) {
      throw new ApiError(400, 'VALIDATION', 'finalEventType and finalPurpose are required');
    }
    setDecision(db, ev.id, { finalEventType: b.finalEventType, finalPurpose: b.finalPurpose });
    return { event: eventDTO(getEvent(db, ev.id)!) };
  });

  // 8. POST /entities/:id/run-rules
  app.post<{ Params: { id: string }; Body: { periodId?: string } }>('/entities/:id/run-rules', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.body?.periodId;
    if (!periodId) throw new ApiError(400, 'VALIDATION', 'periodId is required');
    const candidates = [
      ...listByStatus(db, req.params.id, 'APPROVED'),
      ...listByStatus(db, req.params.id, 'AUTO'),
    ];
    let posted = 0, skipped = 0;
    for (const ev of candidates) {
      const output = evaluate(buildRuleInput(ev, { periodId }));
      if (output.decision !== 'POSTABLE' || output.journalEntries.length === 0) { skipped++; continue; }
      for (const je of output.journalEntries) {
        const res = insertJournalEntry(db, {
          id: `je-${ev.id}-${je.idempotencyKey}`,
          entityId: req.params.id,
          eventId: ev.id,
          jeJson: JSON.stringify(je),
          idempotencyKey: je.idempotencyKey,
          leafHash: leafHash(je),
        });
        if (res === 'inserted') posted++; else skipped++;
      }
      markPosted(db, ev.id);
    }
    return { posted, skipped, journal: journalDTO(db, req.params.id) };
  });

  // 9. GET /entities/:id/journal
  app.get<{ Params: { id: string } }>('/entities/:id/journal', async (req) => {
    requireEntity(db, req.params.id);
    return { journal: journalDTO(db, req.params.id) };
  });

  // 10. POST /entities/:id/snapshot
  app.post<{ Params: { id: string }; Body: { periodId?: string } }>('/entities/:id/snapshot', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.body?.periodId;
    if (!periodId) throw new ApiError(400, 'VALIDATION', 'periodId is required');
    const jes: JournalEntry[] = listJournal(db, req.params.id).map((r) => JSON.parse(r.jeJson) as JournalEntry);
    const outputs = jes.map((je) => ({
      decision: 'POSTABLE' as const,
      assessment: { eventType: 'DIGITAL_ASSET_RECEIPT' as const, accountingClass: '', measurementModel: '' },
      measurements: [], lotMovements: [], journalEntries: [je], disclosureFacts: [], exceptions: [],
      explanation: { ruleIds: [], policyVersions: ['demo-ps-1', 'demo-rule-1'], priceRefs: [], fxRefs: [] },
    }));
    const repo = new InMemorySnapshotRepo();
    const { auditSnapshot } = buildSnapshot(
      outputs,
      { entityId: req.params.id, periodId, createdAtLogical: Date.now() },
      repo,
    );
    const id = `snap-${req.params.id}-${periodId}-${auditSnapshot.seq}`;
    insertSnapshot(db, {
      id, entityId: req.params.id, periodId,
      manifestJson: JSON.stringify(auditSnapshot.manifest),
      manifestHash: auditSnapshot.manifestHash,
      merkleRoot: auditSnapshot.merkleRoot,
      leafCount: auditSnapshot.leafCount,
      supersedesSeq: auditSnapshot.supersedesSeq,
    });
    return {
      snapshot: {
        id, periodId,
        manifestHash: auditSnapshot.manifestHash,
        merkleRoot: auditSnapshot.merkleRoot,
        leafCount: auditSnapshot.leafCount,
        supersedesSeq: auditSnapshot.supersedesSeq,
        status: 'FROZEN',
      },
    };
  });

  // 11. POST /entities/:id/anchor/prepare
  app.post<{ Params: { id: string }; Body: { snapshotId?: string; walletAddress?: string } }>('/entities/:id/anchor/prepare', async (req) => {
    const b = req.body ?? {};
    if (!b.snapshotId || !b.walletAddress) {
      throw new ApiError(400, 'VALIDATION', 'snapshotId and walletAddress are required');
    }
    const ad: AnchorServiceDeps = { db, adapter: deps.anchorAdapter, mutex: deps.mutex, cfg };
    return prepareAnchor(ad, { entityId: req.params.id, snapshotId: b.snapshotId, walletAddress: b.walletAddress });
  });

  // 12. POST /entities/:id/anchor/confirm
  app.post<{ Params: { id: string }; Body: { snapshotId?: string; digest?: string; expectedSeq?: number } }>('/entities/:id/anchor/confirm', async (req) => {
    const b = req.body ?? {};
    if (!b.snapshotId || !b.digest || typeof b.expectedSeq !== 'number') {
      throw new ApiError(400, 'VALIDATION', 'snapshotId, digest, expectedSeq are required');
    }
    const ad: AnchorServiceDeps = { db, adapter: deps.anchorAdapter, mutex: deps.mutex, cfg };
    const anchor = await confirmAnchor(ad, {
      entityId: req.params.id, snapshotId: b.snapshotId, digest: b.digest, expectedSeq: b.expectedSeq,
    });
    return { anchor };
  });

  // 13. GET /entities/:id/anchors
  app.get<{ Params: { id: string }; Querystring: { idempotencyKey?: string } }>('/entities/:id/anchors', async (req) => {
    requireEntity(db, req.params.id);
    const anchors = listAnchors(db, req.params.id).map((r) => ({
      id: r.id, snapshotId: r.snapshotId, seq: r.seq, link: r.link,
      digest: r.digest, explorerUrl: r.explorerUrl, anchoredAt: r.anchoredAt,
    }));
    let proof = null;
    const key = req.query.idempotencyKey;
    if (key) {
      const jes = listJournal(db, req.params.id).map((r) => JSON.parse(r.jeJson) as JournalEntry);
      if (jes.some((j) => j.idempotencyKey === key)) {
        const p = inclusionProof(jes, key);
        const { manifest } = buildMerkle(jes);
        proof = { idempotencyKey: key, leafIndex: p.leafIndex, siblings: p.siblings, merkleRoot: manifest.merkleRoot };
      }
    }
    return { anchors, inclusionProof: proof };
  });
}
