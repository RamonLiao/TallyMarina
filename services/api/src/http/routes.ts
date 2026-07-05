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
import { insertLotMovement, acquireLotSeq } from '../store/lotMovementStore.js';
import { listPeriods } from '../store/periodQuery.js';
import { insertSnapshot, getSnapshot, hasAnchoredSnapshot } from '../store/snapshotStore.js';
import { collectExceptions } from '../exceptions/collect.js';
import { applyDisposition } from '../exceptions/disposition.js';
import { getDisposition } from '../store/dispositionStore.js';
import { BLOCKING_CATEGORIES, REASON_CODES, type DispositionState } from '../exceptions/types.js';
import { listAnchors } from '../store/anchorStore.js';
import { collectBreaks, openMaterialReconBlockers } from '../reconciliation/collect.js';
import { applyReconDisposition } from '../reconciliation/disposition.js';
import { getReconDisposition } from '../store/reconBreakStore.js';
import { RECON_REASON_CODES, type ReconReasonCode } from '../reconciliation/types.js';
import { encodeReconBreakId, decodeReconBreakId, ReconBreakIdError } from '../reconciliation/breakId.js';
import { REOPEN_REASON_CODES, type ReopenReasonCode } from '../periodLock/state.js';
import { getPeriodLock, lockPeriod, reopenPeriod } from '../periodLock/store.js';
import { buildCockpit } from '../periodLock/cockpit.js';
import { hasAnchoredSnapshotForPeriod } from '../store/snapshotStore.js';
import { classifyEvent } from '../ai/classify.js';
import { reviewCopilot } from '../ai/copilot.js';
import { buildRuleInput } from './buildRuleInput.js';
import { lotsForEvent } from './lotsForEvent.js';
import { buildLotsDTO } from '../lots/dto.js';
import { evaluate, buildMerkle, leafHash, inclusionProof, eventTypeSchema, type JournalEntry } from '../deps/rulesEngine.js';
import { buildSnapshot, InMemorySnapshotRepo } from '../deps/snapshotSvc.js';
import { prepareAnchor, confirmAnchor, type AnchorServiceDeps } from './anchorService.js';
import { SnapshotError } from '@subledger/snapshot-svc';
import { DEMO_POLICY_SET, DEMO_COA_RULES } from './policyConstants.js';
import { deriveSources } from '../onboarding/sources.js';
import { issueChallenge } from '../onboarding/challenge.js';
import { verifyOwnership } from '../onboarding/verify.js';
import { latestAttestation, listAttestations } from '../store/onboardingStore.js';
import { DEMO_ENTITY_META } from '../onboarding/constants.js';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { getProposal, listProposals, decideProposal, revertAcceptedToStale, markEntityProposalsStale, type ProposalStatus, type ProposalRow } from '../store/proposalStore.js';
import { makeTriageRunner, type TriageRunner } from '../triage/scheduler.js';
import type { MemoryClient, MemoryRecord } from '../triage/memory/types.js';
import { amountBand } from '../triage/memory/format.js';
import { ingestEvent, PeriodLockedError } from './ingestEvent.js';

export interface RouteDeps {
  db: Db;
  cfg: ApiConfig;
  classifyClient: GeminiClient;
  copilotClient: GeminiClient;
  anchorAdapter: SuiGrpcChainAdapter;
  mutex: { run<T>(key: string, fn: () => Promise<T>): Promise<T> };
  triageRunner?: TriageRunner;
  memory: MemoryClient;
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

export const DEFAULT_PERIOD = '2026-Q2';

// Events have no eventTime column — it lives in rawJson (same source deriveEventPeriod
// parses). insertEvent already gated it as a valid time, so absence here is corruption.
function eventTimeOf(ev: EventRow): string {
  const t = (JSON.parse(ev.rawJson) as { eventTime?: unknown }).eventTime;
  if (typeof t !== 'string' || t.length === 0) {
    throw new ApiError(500, 'INTERNAL', `event ${ev.id} has no eventTime`);
  }
  return t;
}

// Raw (ingestion-normalized) event type, before any human/AI decision.
function rawEventTypeOf(rawJson: string): string | null {
  const t = (JSON.parse(rawJson) as { eventType?: unknown }).eventType;
  return typeof t === 'string' ? t : null;
}

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

function requireEntityForWallet(db: Db, wallet: string): string {
  for (const e of listEntities(db)) {
    let breaks;
    try {
      breaks = collectBreaks(db, e.id, DEFAULT_PERIOD);
    } catch (err) {
      // Skip ONLY the known missing-fixture case; re-throw everything else (Rule 12: fail loud).
      if (err instanceof Error && err.message.startsWith(`no recon fixture for entity`)) continue;
      throw err;
    }
    if (breaks.some((b) => b.wallet === wallet)) return e.id;
  }
  throw new ApiError(404, 'RECON_BREAK_NOT_FOUND', `no entity owns wallet ${wallet}`);
}

function reconDTO(db: Db, entityId: string, periodId: string, liveWallet: string | undefined) {
  const breaks = collectBreaks(db, entityId, periodId);
  const rows = breaks.map((b) => {
    const d = getReconDisposition(db, entityId, periodId, b.wallet, b.coinType);
    return {
      ...b,
      provenance: {
        computed: 'book' as const,
        statement: 'mock' as const,
        chain: (b.coinType === '0x2::sui::SUI' ? 'live' : 'n/a') as 'live' | 'n/a',
      },
      disposition: d ? { state: d.state, reasonCode: d.reasonCode, reasonNote: d.reasonNote } : null,
    };
  });
  const material = rows.filter((r) => r.material).length;
  const openMaterial = rows.filter((r) => r.material && isOpen(r.disposition)).length;
  const balanced = rows.filter((r) => BigInt(r.breakMinor) === 0n).length;
  return { rows, realWallet: liveWallet ?? null, summary: { material, openMaterial, balanced } };
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, cfg, memory } = deps;
  const triage = deps.triageRunner ?? makeTriageRunner({ db, cfg, client: deps.copilotClient, memory });

  function buildRecordFromLive(
    entityId: string, live: { category: string; amount: string | null; ai: { eventType: string | null } | null },
    action: string, reasonCode: string, outcome: 'ACCEPTED' | 'REJECTED', note: string | null,
  ): MemoryRecord {
    return {
      entityId, eventType: live.ai?.eventType ?? null, category: live.category,
      amountBand: amountBand(live.amount), outcome, action, reasonCode, note,
    };
  }
  function fireAndForgetRemember(entityId: string, record: MemoryRecord): void {
    void memory.remember({ entityId, record })
      .then(() => app.log.info({ proposal: record }, 'triage memory write-back ok'))
      .catch((err: Error) => app.log.warn(`triage memory write-back failed: ${err.message}`));
  }

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

  // GET /policy/active — read-only policy constants endpoint
  app.get('/policy/active', async () => ({
    policySet: DEMO_POLICY_SET,
    coaMapping: { rules: DEMO_COA_RULES, defaultAccount: null },
    periodId: DEFAULT_PERIOD,
  }));

  // GET /onboarding/:id — entity meta + derived sources + ownership attestation state
  app.get<{ Params: { id: string } }>('/onboarding/:id', async (req) => {
    const entity = requireEntity(db, req.params.id);
    const sources = deriveSources(db, req.params.id);
    const listed = new Set(sources.map((s) => normalizeSuiAddress(s.wallet)));
    const sourcesOut = sources.map((s) => {
      const att = latestAttestation(db, req.params.id, normalizeSuiAddress(s.wallet));
      return {
        wallet: normalizeSuiAddress(s.wallet), eventCount: s.eventCount, isDemoOwned: s.isDemoOwned,
        ownership: att ? { verified: true, verifiedAt: att.verifiedAt } : { verified: false },
      };
    });
    const unlistedMap = listAttestations(db, req.params.id)
      .filter((a) => !listed.has(a.wallet))
      .reduce<Record<string, { wallet: string; verifiedAt: number }>>((acc, a) => {
        if (!acc[a.wallet] || a.verifiedAt > acc[a.wallet]!.verifiedAt) acc[a.wallet] = { wallet: a.wallet, verifiedAt: a.verifiedAt };
        return acc;
      }, {});
    return {
      entity: { id: entity.id, displayName: entity.displayName, meta: DEMO_ENTITY_META[entity.id] ?? null },
      sources: sourcesOut,
      unlistedVerified: Object.values(unlistedMap),
    };
  });

  // POST /onboarding/challenge — issue single-use nonce
  app.post<{ Body: { wallet?: string } }>('/onboarding/challenge', async (req) => {
    if (!req.body?.wallet) throw new ApiError(400, 'VALIDATION', 'wallet required');
    return issueChallenge(db, cfg.entityId, req.body.wallet, Date.now());
  });

  // POST /onboarding/verify — server-side signature verification → attestation
  app.post<{ Body: { wallet?: string; nonce?: string; signature?: string; connectedAccount?: string } }>(
    '/onboarding/verify',
    async (req) => {
      const { wallet, nonce, signature, connectedAccount } = req.body ?? {};
      if (!wallet || !nonce || !signature) throw new ApiError(400, 'VALIDATION', 'wallet, nonce, signature required');
      const normalizedWallet = normalizeSuiAddress(wallet);
      if (connectedAccount !== undefined && normalizeSuiAddress(connectedAccount) !== normalizedWallet) {
        throw new ApiError(400, 'VALIDATION', 'connectedAccount must match wallet');
      }
      const att = await verifyOwnership(
        db,
        { entityId: cfg.entityId, wallet: normalizedWallet, nonce, signature, connectedAccount: normalizedWallet },
        Date.now(),
      );
      return { verdict: 'VERIFIED', attestation: { wallet: att.wallet, verifiedAt: att.verifiedAt, verifier: att.verifier, templateVersion: att.templateVersion } };
    },
  );

  // 1. GET /entities
  app.get('/entities', async () => ({
    entities: listEntities(db).map((e) => ({
      id: e.id, displayName: e.displayName, chainObjectId: e.chainObjectId,
      capObjectId: e.capObjectId, originalPackageId: e.originalPackageId,
    })),
  }));

  // Classify one event and persist the suggestion. AI failure never throws
  // (classifyEvent degrades to NEEDS_REVIEW); setAiSuggestion can still throw
  // StateError if a concurrent request already transitioned the event.
  async function classifyAndStore(ev: EventRow): Promise<{ degraded: boolean }> {
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
    return { degraded: res.degraded };
  }

  // 2. POST /entities/:id/ingest — classification runs automatically on ingest;
  // the per-event classify endpoint remains for re-display but is a no-op once classified.
  app.post<{ Params: { id: string } }>('/entities/:id/ingest', async (req) => {
    requireEntity(db, req.params.id);
    let classified = 0, degraded = 0;
    for (const ev of listByStatus(db, req.params.id, 'INGESTED')) {
      // Model-vs-code rule: a raw OPENING_LOT is self-describing (historical cost + qty
      // come straight from the payload) — there is nothing for the LLM to judge. Approve
      // it deterministically WITHOUT touching the AI module. The state machine has no
      // INGESTED→APPROVED edge, so we take the same two hops the review path uses
      // (→NEEDS_REVIEW then →APPROVED via setDecision), stamping a deterministic marker
      // that records the LLM was bypassed.
      if (rawEventTypeOf(ev.rawJson) === 'OPENING_LOT') {
        try {
          const purpose = (JSON.parse(ev.rawJson) as { economicPurpose?: unknown }).economicPurpose;
          const finalPurpose = typeof purpose === 'string' && purpose.length > 0 ? purpose : 'OPENING_LOT';
          setAiSuggestion(db, ev.id, {
            aiEventType: 'OPENING_LOT', aiPurpose: finalPurpose, aiCounterparty: null,
            aiConfidence: 1, aiReasoning: 'deterministic OPENING_LOT ingest — LLM bypassed (model-vs-code rule)',
            nextStatus: 'NEEDS_REVIEW',
          });
          setDecision(db, ev.id, { finalEventType: 'OPENING_LOT', finalPurpose });
          classified++;
        } catch (err) {
          if (err instanceof StateError) continue; // concurrent transition — someone else handled it
          throw err;
        }
        continue;
      }
      try {
        const r = await classifyAndStore(ev);
        classified++;
        if (r.degraded) degraded++;
      } catch (err) {
        // Concurrent ingest already transitioned this event between our list
        // and this write — the other request classified it; skip, don't 500.
        if (err instanceof StateError) continue;
        throw err;
      }
    }
    const events = listEvents(db, req.params.id);
    return { ingested: events.length, events: events.map(eventDTO), classified, degraded };
  });

  // 3. GET /entities/:id/events
  app.get<{ Params: { id: string } }>('/entities/:id/events', async (req) => {
    requireEntity(db, req.params.id);
    return { events: listEvents(db, req.params.id).map(eventDTO) };
  });

  // 3a. GET /entities/:id/periods — list periods with lock status (frontend period selector)
  app.get<{ Params: { id: string } }>('/entities/:id/periods', async (req) => {
    requireEntity(db, req.params.id);
    return listPeriods(db, req.params.id);
  });

  // 3b. POST /entities/:id/events — ingest gate: refuses+logs events dated into a LOCKED period.
  app.post<{ Params: { id: string }; Body: { event: unknown } }>('/entities/:id/events', async (req, reply) => {
    requireEntity(db, req.params.id);
    if (req.body?.event === undefined) {
      return reply.code(400).send({ error: { code: 'INVALID_EVENT_TIME', message: 'event body is required' } });
    }
    try {
      const rawJson = JSON.stringify(req.body.event);
      const { eventId, periodId } = ingestEvent(db, req.params.id, rawJson);
      return reply.code(201).send({ eventId, periodId });
    } catch (err) {
      if (err instanceof PeriodLockedError) {
        return reply.code(409).send({
          error: {
            code: 'PERIOD_LOCKED_FOR_DATE', message: err.message,
            details: { periodId: err.periodId, eventTime: err.eventTime },
          },
        });
      }
      if (err instanceof Error && err.message.startsWith('INVALID_EVENT_TIME')) {
        return reply.code(400).send({ error: { code: 'INVALID_EVENT_TIME', message: err.message } });
      }
      throw err;
    }
  });

  // 4. POST /events/:id/classify — idempotent: already-classified events (auto pass
  // on ingest) return their current state instead of an ILLEGAL_TRANSITION 409.
  app.post<{ Params: { id: string } }>('/events/:id/classify', async (req) => {
    const ev = requireEvent(db, req.params.id);
    if (ev.status !== 'INGESTED') {
      return { event: eventDTO(ev), degraded: false };
    }
    const { degraded } = await classifyAndStore(ev);
    return { event: eventDTO(getEvent(db, ev.id)!), degraded };
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
    // Review C1: a human decision is an accounting judgment that changes what a reopen
    // would post — reject it while the period is locked. C2: derive the lock scope from
    // the event's OWN attributed period (never a caller-supplied periodId).
    if (!ev.periodId) {
      throw new ApiError(409, 'PERIOD_UNKNOWN', 'event has no attributed period');
    }
    if (getPeriodLock(db, ev.entityId, ev.periodId).status === 'LOCKED') {
      throw new ApiError(409, 'PERIOD_LOCKED', `period ${ev.periodId} is locked; reopen it before deciding classifications`);
    }
    // finalEventType feeds the rules engine (buildRuleInput); reject unknown types at
    // the boundary instead of letting the event strand as APPROVED-but-unpostable.
    if (!eventTypeSchema.safeParse(b.finalEventType).success) {
      throw new ApiError(400, 'VALIDATION', `unknown finalEventType ${b.finalEventType}; must be one of ${eventTypeSchema.options.join(', ')}`);
    }
    setDecision(db, ev.id, { finalEventType: b.finalEventType, finalPurpose: b.finalPurpose });
    return { event: eventDTO(getEvent(db, ev.id)!) };
  });

  // 8. POST /entities/:id/run-rules
  app.post<{ Params: { id: string }; Body: { periodId?: string } }>('/entities/:id/run-rules', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.body?.periodId;
    if (!periodId) throw new ApiError(400, 'VALIDATION', 'periodId is required');
    // Review C1: a locked period MUST reject new postings — otherwise the on-chain
    // anchor and the books diverge after close. Route guard + engine gate (periodOpen).
    const lock = getPeriodLock(db, req.params.id, periodId);
    const periodOpen = lock.status !== 'LOCKED';
    if (!periodOpen) {
      throw new ApiError(409, 'PERIOD_LOCKED', `period ${periodId} is locked; reopen it before posting`);
    }
    // C2 fix: scope candidates to THIS run's period. listByStatus is entity-wide,
    // so without this filter an event attributed to a different (possibly locked)
    // period would be evaluated against this request's periodOpen and posted under
    // its own periodId — bypassing that period's lock. See routes.ts run-rules review.
    // Sort candidates chronologically by eventTime so originators (OPENING_LOT, receipts)
    // post before the consumers that draw down their lots (spec §2). id breaks ties for a
    // deterministic order.
    const candidates = [
      ...listByStatus(db, req.params.id, 'APPROVED'),
      ...listByStatus(db, req.params.id, 'AUTO'),
    ]
      .filter((ev) => ev.periodId === periodId)
      .sort((a, b) => eventTimeOf(a).localeCompare(eventTimeOf(b)) || a.id.localeCompare(b.id));
    let posted = 0, skipped = 0;
    for (const ev of candidates) {
      const output = evaluate(buildRuleInput(ev, { periodId, periodOpen, lots: lotsForEvent(db, ev) }));
      // JE-less POSTABLE outputs (OPENING_LOT, spec §3) still carry lot movements that
      // must persist — the old `journalEntries.length === 0 → skip` guard is gone.
      if (output.decision !== 'POSTABLE') { skipped++; continue; }
      const acquireStamp = `${eventTimeOf(ev)}|${ev.id}`;
      // JE + movements are one atomic unit (spec §2): an injected movement failure must
      // roll the JE back too — no partial post. Counters mutate only after commit.
      let postedHere = 0, skippedHere = 0;
      const persist = db.transaction(() => {
        postedHere = 0; skippedHere = 0;
        let anchorJeId: string | null = null;
        for (const je of output.journalEntries) {
          const jeId = `je-${ev.id}-${je.idempotencyKey}`;
          const res = insertJournalEntry(db, {
            id: jeId,
            entityId: req.params.id,
            eventId: ev.id,
            jeJson: JSON.stringify(je),
            idempotencyKey: je.idempotencyKey,
            leafHash: leafHash(je),
            periodId: ev.periodId, // inherit from source event (spec §5.2.4)
          });
          if (res === 'inserted') { postedHere++; if (anchorJeId === null) anchorJeId = jeId; } else skippedHere++;
        }
        // Movement idempotency root: the first JE's key (a JE-less opening lot roots on the
        // event id). Guarantees replay collides on idempotency_key → INSERT OR IGNORE no-op.
        const anchorKey = output.journalEntries[0]?.idempotencyKey ?? ev.id;
        for (const m of output.lotMovements) {
          const isAcquire = !m.deltaQtyMinor.startsWith('-');
          insertLotMovement(db, {
            id: `lm-${anchorKey}-${m.lotId}`,
            entityId: ev.entityId, eventId: ev.id, jeId: anchorJeId,
            lotId: m.lotId,
            // Consume rows stamp the ACQUIRE lot's own lot_seq (spec §2). acquireLotSeq
            // fails loud if the referenced lot has no persisted acquire row — the Task-3
            // provisional fallback is gone now that buildRuleInput folds real lots.
            lotSeq: isAcquire ? acquireStamp : acquireLotSeq(db, ev.entityId, m.lotId),
            periodId: ev.periodId!, coinType: m.coinType, wallet: m.wallet,
            deltaQtyMinor: m.deltaQtyMinor, deltaCostMinor: m.deltaCostMinor,
            costBasisMethod: 'FIFO', policySetVersion: DEMO_POLICY_SET.policySetVersion,
            idempotencyKey: `${anchorKey}|${m.lotId}`,
          });
        }
      });
      persist();
      posted += postedHere; skipped += skippedHere;
      markPosted(db, ev.id);
    }
    return { posted, skipped, journal: journalDTO(db, req.params.id) };
  });

  // 9. GET /entities/:id/journal
  app.get<{ Params: { id: string } }>('/entities/:id/journal', async (req) => {
    requireEntity(db, req.params.id);
    return { journal: journalDTO(db, req.params.id) };
  });

  // 9a. GET /entities/:id/lots — folded remaining lots with provenance, movement history,
  // and fail-loud drift objects (persisted fold vs recompute-on-read). READ-ONLY.
  app.get<{ Params: { id: string } }>('/entities/:id/lots', async (req) => {
    requireEntity(db, req.params.id);
    return buildLotsDTO(db, req.params.id);
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
    const exBlockers = exceptionDTO(db, req.params.id, periodId, cfg.exceptionLowConfidence)
      .filter((e) => BLOCKING_CATEGORIES.includes(e.category) && isOpen(e.disposition));
    const reconBlockers = openMaterialReconBlockers(db, req.params.id, periodId);
    return {
      exceptions: { blocking: exBlockers.length, blockers: exBlockers },
      recon: { blocking: reconBlockers.length, blockers: reconBlockers.map((b) => encodeReconBreakId(b.wallet, b.coinType)) },
      closeable: exBlockers.length === 0 && reconBlockers.length === 0,
    };
  });

  // Period Close Cockpit (Phase 2 B1)
  const LOCKED_BY = 'demo-controller'; // server-const until auth (spec §9 SoD blocking-for-production)

  app.get<{ Params: { id: string }; Querystring: { periodId?: string } }>('/entities/:id/close-cockpit', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.query.periodId;
    if (!periodId) throw new ApiError(400, 'PERIOD_ID_REQUIRED', 'periodId query param is required');
    return buildCockpit(db, req.params.id, periodId, cfg.exceptionLowConfidence);
  });

  app.post<{ Params: { id: string }; Body: { periodId?: string } }>('/entities/:id/period/lock', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = (req.body as { periodId?: string } | undefined)?.periodId;
    if (!periodId) throw new ApiError(400, 'PERIOD_ID_REQUIRED', 'periodId is required');
    // Recompute server-side — NEVER trust client-sent lights.
    const view = buildCockpit(db, req.params.id, periodId, cfg.exceptionLowConfidence);
    if (!view.closeable) {
      const reds = view.lights.filter((l) => l.status !== 'mock' && l.status !== 'green').map((l) => l.key);
      throw new ApiError(409, 'LIGHTS_NOT_GREEN', `blocking lights not green: ${reds.join(', ')}`);
    }
    try {
      const row = lockPeriod(db, {
        entityId: req.params.id, periodId,
        lightsSnapshot: JSON.stringify(view.lights), lockedBy: LOCKED_BY, now: Date.now(),
      });
      markEntityProposalsStale(db, req.params.id, periodId, LOCKED_BY, Date.now());
      return { lock: row };
    } catch (err) {
      if ((err as Error).message.startsWith('ILLEGAL_TRANSITION')) throw new ApiError(409, 'ILLEGAL_TRANSITION', (err as Error).message);
      throw err;
    }
  });

  app.post<{ Params: { id: string }; Body: { periodId?: string; restatementReason?: string; reasonCode?: string; affectedAmountEstimate?: string } }>('/entities/:id/period/reopen', async (req) => {
    requireEntity(db, req.params.id);
    const b = req.body as { periodId?: string; restatementReason?: string; reasonCode?: string; affectedAmountEstimate?: string } | undefined ?? {};
    const periodId = b.periodId ?? DEFAULT_PERIOD;
    const reason = (b.restatementReason ?? '').trim();
    if (!reason) throw new ApiError(400, 'VALIDATION', 'restatementReason required');
    if (reason.length > 512) throw new ApiError(400, 'VALIDATION', 'restatementReason exceeds 512 chars');
    if (!b.reasonCode || !REOPEN_REASON_CODES.includes(b.reasonCode as ReopenReasonCode)) {
      throw new ApiError(400, 'VALIDATION', `unknown reasonCode ${b.reasonCode}`);
    }
    const wasAnchored = hasAnchoredSnapshotForPeriod(db, req.params.id, periodId);
    try {
      const row = reopenPeriod(db, {
        entityId: req.params.id, periodId, restatementReason: reason,
        reasonCode: b.reasonCode as ReopenReasonCode,
        affectedAmountEstimate: b.affectedAmountEstimate ?? null,
        wasAnchored, requestedBy: LOCKED_BY, approvedBy: LOCKED_BY, now: Date.now(),
      });
      return { lock: row };
    } catch (err) {
      if ((err as Error).message.startsWith('ILLEGAL_TRANSITION')) throw new ApiError(409, 'ILLEGAL_TRANSITION', (err as Error).message);
      throw err;
    }
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
        source: 'HUMAN',
      });
      return { disposition: row };
    } catch (err) {
      if ((err as Error).message.startsWith('ILLEGAL_TRANSITION')) {
        throw new ApiError(409, 'ILLEGAL_TRANSITION', (err as Error).message);
      }
      throw err;
    }
  });

  // Triage agent (exception-triage proposals — agent proposes, human accepts)
  app.post<{ Params: { id: string }; Body: { periodId?: string } }>('/entities/:id/triage/run', async (req) => {
    requireEntity(db, req.params.id);
    const rawPeriodId = req.body?.periodId;
    if (rawPeriodId !== undefined && typeof rawPeriodId !== 'string') {
      throw new ApiError(400, 'VALIDATION', 'periodId must be a string');
    }
    // F1a: the demo is single-period (events carry no period; review C2 deferred), so the
    // lock/anchor sweep only ever runs against DEFAULT_PERIOD. Accepting an arbitrary
    // periodId lets a caller probe an unlocked "FAKE" period lock row while the real
    // period is LOCKED — the agent would then propose against live exceptions and the
    // period-scoped stale-sweep (markEntityProposalsStale) would never touch them.
    const periodId = rawPeriodId ?? DEFAULT_PERIOD;
    if (periodId !== DEFAULT_PERIOD) {
      throw new ApiError(400, 'VALIDATION', `unknown periodId ${periodId}`);
    }
    try {
      return { run: await triage.runOnce(req.params.id, periodId) };
    } catch (err) {
      if ((err as Error).message === 'TRIAGE_BUSY') throw new ApiError(409, 'TRIAGE_BUSY', 'a triage run is already in progress');
      throw err;
    }
  });

  app.get<{ Params: { id: string }; Querystring: { status?: string } }>('/entities/:id/triage/proposals', async (req) => {
    requireEntity(db, req.params.id);
    // Lazy stale sweep (I2): anchored entity can never accept — expire open proposals.
    if (hasAnchoredSnapshot(db, req.params.id)) markEntityProposalsStale(db, req.params.id, null, LOCKED_BY, Date.now());
    const q = req.query.status ?? 'proposed';
    if (q !== 'all' && !['proposed', 'accepted', 'rejected', 'stale'].includes(q)) {
      throw new ApiError(400, 'VALIDATION', `unknown status ${q}`);
    }
    const rows = q === 'all' ? listProposals(db, req.params.id) : listProposals(db, req.params.id, q as ProposalStatus);
    // §3.1a: recall provenance is audit-only this round, never surfaced in the list DTO.
    // Kept in the DB row and in getProposal (used internally) — stripped only here.
    return { proposals: rows.map(({ recallContext: _recallContext, ...rest }): Omit<ProposalRow, 'recallContext'> => rest) };
  });

  app.post<{ Params: { id: string } }>('/triage/proposals/:id/accept', async (req) => {
    // F5: Number('0x10') === 16, Number(' 12 ') === 12, etc. — only accept plain decimal ids.
    const p = /^\d+$/.test(req.params.id) ? getProposal(db, Number(req.params.id)) : null;
    if (!p) throw new ApiError(404, 'PROPOSAL_NOT_FOUND', `no proposal ${req.params.id}`);
    if (p.status !== 'proposed') throw new ApiError(409, 'PROPOSAL_NOT_OPEN', `proposal is ${p.status}`);
    // B1: same guard as the manual disposition path — anchored = read-only. NOT period-lock:
    // locked-but-not-anchored proposals were already swept stale at lock time.
    if (hasAnchoredSnapshot(db, p.entityId)) {
      markEntityProposalsStale(db, p.entityId, null, LOCKED_BY, Date.now());
      throw new ApiError(409, 'ANCHORED_READ_ONLY', 'period anchored, exceptions are informational');
    }
    // F1b defense-in-depth: a lock landing between triage/run's round-start check and this
    // accept (TOCTOU) must still stale the proposal. This makes agent-accept strictly
    // stricter than the manual disposition route (which only checks anchored, not lock) —
    // intentional per spec: a period lock must stale agent proposals even though a human
    // can still dispose manually up to anchor. See runTriageOnce's per-insert re-check for
    // the write-side half of this fix.
    if (getPeriodLock(db, p.entityId, p.periodId).status === 'LOCKED') {
      decideProposal(db, p.id, 'stale', LOCKED_BY, 'period locked', Date.now());
      throw new ApiError(409, 'PERIOD_LOCKED', `period ${p.periodId} is locked`);
    }
    // I3: re-validate against the live projection, same as the manual route.
    const live = collectExceptions(db, p.entityId, p.periodId, cfg.exceptionLowConfidence)
      .find((e) => e.exceptionId === p.exceptionId);
    if (!live) {
      decideProposal(db, p.id, 'stale', LOCKED_BY, 'exception no longer current', Date.now());
      throw new ApiError(409, 'PROPOSAL_STALE', 'exception no longer current — proposal expired');
    }
    // CPA F7: live RULES_FAILED means evaluate() still fails (collectExceptions runs it);
    // marking it resolved would hide a rule that still cannot post. Fix the mapping first.
    if (p.action === 'resolved' && live.category === 'RULES_FAILED') {
      throw new ApiError(409, 'STILL_FAILING', 'rule still fails for this event — fix the mapping, the exception will clear itself');
    }
    if (!decideProposal(db, p.id, 'accepted', LOCKED_BY, null, Date.now())) {
      throw new ApiError(409, 'PROPOSAL_NOT_OPEN', 'proposal was decided concurrently');
    }
    try {
      const row = applyDisposition(db, {
        entityId: p.entityId, category: live.category, eventId: p.eventId,
        to: p.action, reasonCode: p.reasonCode, reasonNote: p.reasonNote,
        decidedBy: LOCKED_BY, now: Date.now(),
        source: 'AGENT_PROPOSAL', proposalId: p.id,
      });
      const accepted = getProposal(db, p.id)!;
      fireAndForgetRemember(p.entityId, buildRecordFromLive(p.entityId, live, accepted.action, accepted.reasonCode, 'ACCEPTED', null));
      return { disposition: row, proposal: accepted };
    } catch (err) {
      // Any applyDisposition failure — not just ILLEGAL_TRANSITION — must not leave the
      // proposal 'accepted' with no disposition row (that would misrepresent the audit
      // trail as an applied AI-assisted decision). revertAcceptedToStale is a no-op if
      // the row isn't 'accepted'.
      revertAcceptedToStale(db, p.id, Date.now());
      if ((err as Error).message.startsWith('ILLEGAL_TRANSITION')) {
        throw new ApiError(409, 'PROPOSAL_STALE', (err as Error).message);
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>('/triage/proposals/:id/reject', async (req) => {
    // F5: reject non-decimal ids (e.g. '0x10') before Number() coercion.
    const p = /^\d+$/.test(req.params.id) ? getProposal(db, Number(req.params.id)) : null;
    if (!p) throw new ApiError(404, 'PROPOSAL_NOT_FOUND', `no proposal ${req.params.id}`);
    const note = req.body?.note ?? null;
    // F3: a non-string note (e.g. {"note": 123}) has no .length check that can save it —
    // number.length is undefined, undefined>500 is false, so it would reach better-sqlite3's
    // bind and throw a raw 500. Reject the type at the boundary instead.
    if (note !== null && typeof note !== 'string') throw new ApiError(400, 'VALIDATION', 'note must be a string');
    if (note !== null && note.length > 500) throw new ApiError(400, 'VALIDATION', 'note exceeds 500 chars');
    if (!decideProposal(db, p.id, 'rejected', LOCKED_BY, note, Date.now())) {
      throw new ApiError(409, 'PROPOSAL_NOT_OPEN', `proposal is ${getProposal(db, p.id)!.status}`);
    }
    // write-back: reconstruct the live exception for features; fail-open if it's already gone.
    try {
      const live = collectExceptions(db, p.entityId, p.periodId, cfg.exceptionLowConfidence)
        .find((e) => e.exceptionId === p.exceptionId);
      if (live) fireAndForgetRemember(p.entityId, buildRecordFromLive(p.entityId, live, p.action, p.reasonCode, 'REJECTED', note));
    } catch (err) {
      app.log.warn(`triage memory reject write-back skipped: ${(err as Error).message}`);
    }
    return { proposal: getProposal(db, p.id) };
  });

  // 10. POST /entities/:id/snapshot
  app.post<{ Params: { id: string }; Body: { periodId?: string } }>('/entities/:id/snapshot', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.body?.periodId;
    if (!periodId) throw new ApiError(400, 'VALIDATION', 'periodId is required');
    // Wrap in mutex (architect I3) so the LOCKED-gate read is consistent with the insert.
    return deps.mutex.run(req.params.id, async () => {
      // PERIOD_NOT_LOCKED must be the FIRST guard (before exceptions/recon gates):
      // an OPEN fresh entity has un-dismissed recon breaks; if the recon gate ran first,
      // the OPEN-period check would get 409 RECON_BREAKS_BLOCKING instead of PERIOD_NOT_LOCKED.
      const lock = getPeriodLock(db, req.params.id, periodId);
      if (lock.status !== 'LOCKED') {
        throw new ApiError(409, 'PERIOD_NOT_LOCKED', 'lock the period before anchoring');
      }
      // Close gate (spec §4): open blocking exceptions hard-block the freeze.
      const blockers = exceptionDTO(db, req.params.id, periodId, cfg.exceptionLowConfidence)
        .filter((e) => BLOCKING_CATEGORIES.includes(e.category) && isOpen(e.disposition));
      if (blockers.length > 0) {
        throw new ApiError(409, 'EXCEPTIONS_BLOCKING', `${blockers.length} open exception(s) block close: ${blockers.map((b) => b.exceptionId).join(', ')}`);
      }
      const reconBlockers = openMaterialReconBlockers(db, req.params.id, periodId);
      if (reconBlockers.length > 0) {
        throw new ApiError(409, 'RECON_BREAKS_BLOCKING',
          `${reconBlockers.length} open material break(s) block close: ${reconBlockers.map((b) => encodeReconBreakId(b.wallet, b.coinType)).join(', ')}`);
      }
      const jes: JournalEntry[] = listJournal(db, req.params.id, periodId).map((r) => JSON.parse(r.jeJson) as JournalEntry);
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

  // Reconciliation Workspace (Phase 1 A-3)
  app.get<{ Params: { id: string }; Querystring: { periodId?: string } }>('/entities/:id/reconciliation', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.query.periodId ?? DEFAULT_PERIOD;
    return reconDTO(db, req.params.id, periodId, cfg.reconLiveWallet);
  });

  app.post<{ Params: { breakId: string }; Body: { state?: string; reasonCode?: string; reasonNote?: string; periodId?: string } }>('/recon-breaks/:breakId/disposition', async (req) => {
    const decoded = decodeURIComponent(req.params.breakId);
    let wallet: string, coinType: string;
    try {
      ({ wallet, coinType } = decodeReconBreakId(decoded));
    } catch (err) {
      if (err instanceof ReconBreakIdError) throw new ApiError(400, 'VALIDATION', err.message);
      throw err;
    }
    const b = req.body ?? {};
    if (!b.state || !b.reasonCode) throw new ApiError(400, 'VALIDATION', 'state and reasonCode are required');
    const VALID_STATES: string[] = ['open', 'resolved', 'dismissed', 'deferred'];
    if (!VALID_STATES.includes(b.state)) throw new ApiError(400, 'VALIDATION', `unknown state ${b.state}; must be one of ${VALID_STATES.join(', ')}`);
    if (!RECON_REASON_CODES.includes(b.reasonCode as ReconReasonCode)) throw new ApiError(400, 'VALIDATION', `unknown reasonCode ${b.reasonCode}`);
    if (b.reasonCode === 'OTHER' && !b.reasonNote) throw new ApiError(400, 'VALIDATION', 'reasonNote required when reasonCode is OTHER');
    const periodId = b.periodId ?? DEFAULT_PERIOD;

    const entityId = requireEntityForWallet(db, wallet);
    const liveBreaks = collectBreaks(db, entityId, periodId);
    if (!liveBreaks.find((x) => x.wallet === wallet && x.coinType === coinType)) {
      throw new ApiError(404, 'RECON_BREAK_NOT_FOUND', `no current break ${decoded}`);
    }

    if (hasAnchoredSnapshot(db, entityId)) {
      throw new ApiError(409, 'ANCHORED_READ_ONLY', 'period anchored, reconciliation is informational');
    }
    try {
      const row = applyReconDisposition(db, {
        entityId, periodId, wallet, coinType,
        to: b.state as DispositionState, reasonCode: b.reasonCode as ReconReasonCode,
        reasonNote: b.reasonNote ?? null, decidedBy: 'demo-controller', now: Date.now(),
      });
      return { disposition: row };
    } catch (err) {
      if ((err as Error).message.startsWith('ILLEGAL_TRANSITION')) throw new ApiError(409, 'ILLEGAL_TRANSITION', (err as Error).message);
      throw err;
    }
  });

  // 13. GET /entities/:id/anchors
  app.get<{ Params: { id: string }; Querystring: { idempotencyKey?: string } }>('/entities/:id/anchors', async (req) => {
    requireEntity(db, req.params.id);
    const anchors = listAnchors(db, req.params.id).map((r) => {
      const snap = getSnapshot(db, r.snapshotId);
      return {
        id: r.id, snapshotId: r.snapshotId, seq: r.seq, link: r.link,
        digest: r.digest, explorerUrl: r.explorerUrl, anchoredAt: r.anchoredAt,
        merkleRoot: snap?.merkleRoot ?? null,
        periodId: snap?.periodId ?? '',
        leafCount: snap?.leafCount ?? 0,
      };
    });
    let proof = null;
    const key = req.query.idempotencyKey;
    if (key) {
      const all = listJournal(db, req.params.id);
      const target = all.find((r) => r.idempotencyKey === key);
      if (target && target.periodId) {
        const jes = listJournal(db, req.params.id, target.periodId).map((r) => JSON.parse(r.jeJson) as JournalEntry);
        const p = inclusionProof(jes, key);
        const { manifest } = buildMerkle(jes);
        proof = { idempotencyKey: key, leafIndex: p.leafIndex, siblings: p.siblings, merkleRoot: manifest.merkleRoot };
      }
    }
    return { anchors, inclusionProof: proof };
  });
}
