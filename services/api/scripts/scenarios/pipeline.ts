/**
 * pipeline.ts — shared classify→decide→run-rules→journal→snapshot pipeline
 * for e2e scenario tests. Transcribed from demo-e2e.ts:59–145, swapping
 * the inline makeGeminiClient for the passed classifyClient.
 */
import type { Db } from '../../src/store/db.js';
import type { ApiConfig } from '../../src/config.js';
import type { GeminiClient } from '../../src/ai/geminiClient.js';
import {
  listEvents, setAiSuggestion, setDecision, markPosted, listByStatus,
} from '../../src/store/eventStore.js';
import { insertJournalEntry, listJournal } from '../../src/store/journalStore.js';
import { insertSnapshot } from '../../src/store/snapshotStore.js';
import { buildRuleInput } from '../../src/http/buildRuleInput.js';
import { evaluate, leafHash, type JournalEntry } from '../../src/deps/rulesEngine.js';
import { buildSnapshot, InMemorySnapshotRepo } from '../../src/deps/snapshotSvc.js';
import { classifyEvent } from '../../src/ai/classify.js';

export async function runPipeline(
  db: Db,
  cfg: ApiConfig,
  classifyClient: GeminiClient,
  { periodId }: { periodId: string },
): Promise<{ snapId: string }> {
  // ── 1. Classify every event ──
  for (const ev of listEvents(db, cfg.entityId)) {
    const r = await classifyEvent(
      { rawJson: ev.rawJson },
      { client: classifyClient, model: cfg.aiModelClassify, threshold: cfg.aiConfidenceThreshold },
    );
    setAiSuggestion(db, ev.id, {
      aiEventType: r.suggestion.eventType,
      aiPurpose: r.suggestion.economicPurpose,
      aiCounterparty: r.suggestion.counterparty,
      aiConfidence: r.suggestion.confidence,
      aiReasoning: r.suggestion.reasoning,
      nextStatus: r.routing,
    });
    console.log(`  classify ${ev.id}: conf=${r.suggestion.confidence.toFixed(2)} → ${r.routing}${r.degraded ? ' (degraded)' : ''}`);
  }

  // ── 2. Auto-approve NEEDS_REVIEW via direct-parse (demo only) ──
  for (const ev of listByStatus(db, cfg.entityId, 'NEEDS_REVIEW')) {
    const ne = JSON.parse(ev.rawJson) as { eventType?: string; economicPurpose?: string };
    setDecision(db, ev.id, {
      finalEventType: ne.eventType ?? 'DIGITAL_ASSET_RECEIPT',
      finalPurpose: ne.economicPurpose ?? 'TRADING',
    });
  }

  // ── 3. Run rules → journal entries ──
  const approved = [
    ...listByStatus(db, cfg.entityId, 'APPROVED'),
    ...listByStatus(db, cfg.entityId, 'AUTO'),
  ];
  for (const ev of approved) {
    const out = evaluate(buildRuleInput(ev, { periodId, periodOpen: true })); // scenario DB — period never locked at this stage;
    if (out.decision !== 'POSTABLE') {
      console.warn(`  SKIP ${ev.id}: ${out.decision} ${JSON.stringify(out.exceptions)}`);
      continue;
    }
    for (const je of out.journalEntries) {
      insertJournalEntry(db, {
        id: `je-${ev.id}-${je.idempotencyKey}`,
        entityId: cfg.entityId,
        eventId: ev.id,
        jeJson: JSON.stringify(je),
        idempotencyKey: je.idempotencyKey,
        leafHash: leafHash(je),
      });
    }
    markPosted(db, ev.id);
    console.log(`  posted ${ev.id}: ${out.journalEntries.length} JE(s)`);
  }

  const jeRows = listJournal(db, cfg.entityId);
  if (jeRows.length === 0) throw new Error('no journal entries posted — fix buildRuleInput / fixture data');
  const jes: JournalEntry[] = jeRows.map((r) => JSON.parse(r.jeJson) as JournalEntry);
  console.log(`[pipeline] ${jes.length} journal entries`);

  // ── 4. Snapshot ──
  const outputs = jes.map((je) => ({
    decision: 'POSTABLE' as const,
    assessment: { eventType: 'DIGITAL_ASSET_RECEIPT' as const, accountingClass: '', measurementModel: '' },
    measurements: [],
    lotMovements: [],
    journalEntries: [je],
    disclosureFacts: [],
    exceptions: [],
    explanation: { ruleIds: [], policyVersions: ['demo-ps-1', 'demo-rule-1'], priceRefs: [], fxRefs: [] },
  }));
  const { auditSnapshot } = buildSnapshot(
    outputs,
    { entityId: cfg.entityId, periodId, createdAtLogical: Date.now() },
    new InMemorySnapshotRepo(),
  );
  const snapId = `snap-${cfg.entityId}-${periodId}-${auditSnapshot.seq}`;
  insertSnapshot(db, {
    id: snapId,
    entityId: cfg.entityId,
    periodId,
    manifestJson: JSON.stringify(auditSnapshot.manifest),
    manifestHash: auditSnapshot.manifestHash,
    merkleRoot: auditSnapshot.merkleRoot,
    leafCount: auditSnapshot.leafCount,
    supersedesSeq: auditSnapshot.supersedesSeq,
  });
  console.log(`[pipeline] snapshot ${snapId} (seq=${auditSnapshot.seq}, leaves=${auditSnapshot.leafCount})`);

  return { snapId };
}
