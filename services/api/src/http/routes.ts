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
import { insertSnapshot, getSnapshot, hasAnchoredSnapshot } from '../store/snapshotStore.js';
import { collectExceptions } from '../exceptions/collect.js';
import { applyDisposition } from '../exceptions/disposition.js';
import { getDisposition } from '../store/dispositionStore.js';
import { BLOCKING_CATEGORIES, REASON_CODES, type DispositionState } from '../exceptions/types.js';
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

const DEFAULT_PERIOD = '2026-Q2';

function exceptionDTO(db: Db, entityId: string, periodId: string, lowConf: number) {
  const anchored = hasAnchoredSnapshot(db, entityId);
  return collectExceptions(db, entityId, periodId, lowConf).map((ex) => {
    const d = getDisposition(db, ex.category, ex.eventId);
    return {
      ...ex,
      disposition: d ? { state: d.state, reasonCode: d.reasonCode, decidedBy: d.decidedBy, decidedAt: d.decidedAt } : null,
      anchoredReadOnly: anchored,
    };
  });
}

function isOpen(d: { state: DispositionState } | null): boolean {
  return d === null || d.state === 'open';
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
    reply.log.error({ err }, 'unhandled error');
    return reply.code(500).send(toEnvelope('INTERNAL', 'Internal error'));
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

  // Exception Queue (Phase 1 A-1)
  app.get<{ Params: { id: string }; Querystring: { periodId?: string } }>('/entities/:id/exceptions', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.query.periodId ?? DEFAULT_PERIOD;
    const list = exceptionDTO(db, req.params.id, periodId, cfg.exceptionLowConfidence);
    const blocking = list.filter((e) => BLOCKING_CATEGORIES.includes(e.category) && isOpen(e.disposition)).length;
    const byCategory: Record<string, number> = {};
    for (const e of list) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    return { exceptions: list, summary: { open: list.filter((e) => isOpen(e.disposition)).length, blocking, byCategory } };
  });

  app.get<{ Params: { id: string }; Querystring: { periodId?: string } }>('/entities/:id/close-readiness', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.query.periodId ?? DEFAULT_PERIOD;
    const blockers = exceptionDTO(db, req.params.id, periodId, cfg.exceptionLowConfidence)
      .filter((e) => BLOCKING_CATEGORIES.includes(e.category) && isOpen(e.disposition));
    return { blocking: blockers.length, blockers };
  });

  app.post<{ Params: { exceptionId: string }; Body: { state?: string; reasonCode?: string; reasonNote?: string; periodId?: string } }>('/exceptions/:exceptionId/disposition', async (req) => {
    const decoded = decodeURIComponent(req.params.exceptionId);
    const sep = decoded.indexOf(':');
    if (sep < 0) throw new ApiError(400, 'VALIDATION', 'exceptionId must be category:eventId');
    const category = decoded.slice(0, sep);
    const eventId = decoded.slice(sep + 1);
    const b = req.body ?? {};
    if (!b.state || !b.reasonCode) throw new ApiError(400, 'VALIDATION', 'state and reasonCode are required');
    if (!REASON_CODES.includes(b.reasonCode as never)) throw new ApiError(400, 'VALIDATION', `unknown reasonCode ${b.reasonCode}`);
    if (b.reasonCode === 'OTHER' && !b.reasonNote) throw new ApiError(400, 'VALIDATION', 'reasonNote required when reasonCode is OTHER');

    // Re-validate against live exceptions — reject forged / stale ids.
    const ev = getEvent(db, eventId);
    if (!ev) throw new ApiError(404, 'EXCEPTION_NOT_FOUND', `no event ${eventId}`);
    const live = collectExceptions(db, ev.entityId, b.periodId ?? DEFAULT_PERIOD, cfg.exceptionLowConfidence)
      .find((e) => e.category === category && e.eventId === eventId);
    if (!live) throw new ApiError(404, 'EXCEPTION_NOT_FOUND', `no current exception ${decoded}`);

    // Spec §4: anchored periods are read-only — reject all disposition writes.
    if (hasAnchoredSnapshot(db, ev.entityId)) {
      throw new ApiError(409, 'ANCHORED_READ_ONLY', 'period anchored, exceptions are informational');
    }

    try {
      const row = applyDisposition(db, {
        entityId: ev.entityId, category, eventId,
        to: b.state as DispositionState, reasonCode: b.reasonCode as never,
        reasonNote: b.reasonNote ?? null, decidedBy: 'demo-controller', now: Date.now(),
      });
      return { disposition: row };
    } catch (err) {
      if ((err as Error).message.startsWith('ILLEGAL_TRANSITION')) {
        throw new ApiError(409, 'ILLEGAL_TRANSITION', (err as Error).message);
      }
      throw err;
    }
  });

  // 10. POST /entities/:id/snapshot
  app.post<{ Params: { id: string }; Body: { periodId?: string } }>('/entities/:id/snapshot', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.body?.periodId;
    if (!periodId) throw new ApiError(400, 'VALIDATION', 'periodId is required');
    // Close gate (spec §4): open blocking exceptions hard-block the freeze.
    const blockers = exceptionDTO(db, req.params.id, periodId, cfg.exceptionLowConfidence)
      .filter((e) => BLOCKING_CATEGORIES.includes(e.category) && isOpen(e.disposition));
    if (blockers.length > 0) {
      throw new ApiError(409, 'EXCEPTIONS_BLOCKING', `${blockers.length} open exception(s) block close: ${blockers.map((b) => b.exceptionId).join(', ')}`);
    }
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
    // Idempotent freeze: snapshot id is content-deterministic, so re-freezing the
    // same period collides on the PRIMARY KEY. Resolve an existing row to a fail-closed
    // DTO: the `-`-joined id is ambiguous, so verify entityId + periodId match this
    // request (no cross-entity leak), then verify content via merkleRoot (the journal
    // fingerprint — manifestHash folds in createdAtLogical and is NOT a content invariant).
    const resolveExisting = () => {
      const ex = getSnapshot(db, id);
      if (!ex) return null;
      if (ex.entityId !== req.params.id || ex.periodId !== periodId) {
        throw new ApiError(409, 'SNAPSHOT_CONFLICT', `snapshot id ${id} resolves to a different entity/period`);
      }
      if (ex.merkleRoot !== auditSnapshot.merkleRoot) {
        throw new ApiError(409, 'SNAPSHOT_CONFLICT', `snapshot ${id} exists with a different merkle root`);
      }
      // Fail loud: a non-FROZEN existing row (already ANCHORED) must NOT be returned as a
      // freshly-freezable snapshot — the UI would offer Anchor and prepare would then 409.
      if (ex.status !== 'FROZEN') {
        throw new ApiError(409, 'ALREADY_ANCHORED', `snapshot ${id} is ${ex.status}; the period is already anchored`);
      }
      return {
        snapshot: {
          id, periodId,
          manifestHash: ex.manifestHash, merkleRoot: ex.merkleRoot,
          leafCount: ex.leafCount, supersedesSeq: ex.supersedesSeq, status: ex.status,
        },
      };
    };
    const pre = resolveExisting();
    if (pre) return pre;
    try {
      insertSnapshot(db, {
        id, entityId: req.params.id, periodId,
        manifestJson: JSON.stringify(auditSnapshot.manifest),
        manifestHash: auditSnapshot.manifestHash,
        merkleRoot: auditSnapshot.merkleRoot,
        leafCount: auditSnapshot.leafCount,
        supersedesSeq: auditSnapshot.supersedesSeq,
      });
    } catch (e) {
      // Race: a concurrent freeze inserted between our read and write. Re-resolve and
      // return idempotently; re-throw anything that is not the PK collision.
      if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) {
        const post = resolveExisting();
        if (post) return post;
      }
      throw e;
    }
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
  app.post<{ Params: { id: string }; Body: { snapshotId?: string; walletAddress?: string; manifestHash?: string; merkleRoot?: string } }>('/entities/:id/anchor/prepare', async (req) => {
    const b = req.body ?? {};
    if (!b.snapshotId || !b.walletAddress) {
      throw new ApiError(400, 'VALIDATION', 'snapshotId and walletAddress are required');
    }
    // Anti-tamper: hashes are always derived server-side from the snapshot row. Reject any client-supplied hash.
    if (b.manifestHash || b.merkleRoot) {
      throw new ApiError(400, 'CLIENT_HASH_REJECTED', 'manifestHash and merkleRoot must not be supplied by the client; they are read from the server snapshot');
    }
    if (!deps.anchorAdapter) {
      throw new ApiError(502, 'CHAIN_UNREACHABLE', 'SUI gRPC client not configured');
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
    if (!deps.anchorAdapter) {
      throw new ApiError(502, 'CHAIN_UNREACHABLE', 'SUI gRPC client not configured');
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
      merkleRoot: getSnapshot(db, r.snapshotId)?.merkleRoot ?? null,
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
