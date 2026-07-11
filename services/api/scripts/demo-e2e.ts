/**
 * demo-e2e.ts — drives the full close-the-period pipeline in-process.
 *
 * Prerequisites for the FULL write path (anchor on-chain):
 *   SUI_PK   — Sui private key (suiprivkey… bech32) of the wallet that owns:
 *                - AnchorCap 0xaa1f65d8a2238ec0012d14413ee069207fa493274a71c53129a322489c8e8a73
 *                - enough SUI gas (faucet: https://faucet.testnet.sui.io)
 *
 * If SUI_PK is absent, the script runs every step up to anchor/prepare (read-only)
 * and exits with a clear message. No private key is needed to verify the full
 * classify → decide → run-rules → snapshot → prepare pipeline.
 *
 * Run:
 *   npx tsx services/api/scripts/demo-e2e.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/store/db.js';
import { seed } from '../src/store/seed.js';
import {
  listEvents, setAiSuggestion, setDecision, markPosted, listByStatus,
} from '../src/store/eventStore.js';
import { insertJournalEntry, listJournal } from '../src/store/journalStore.js';
import { insertLotMovement, acquireLotSeq } from '../src/store/lotMovementStore.js';
import { insertSnapshot } from '../src/store/snapshotStore.js';
import { buildRuleInput } from '../src/http/buildRuleInput.js';
import { lotsForEvent } from '../src/http/lotsForEvent.js';
import { getActivePolicy, getActiveCoaMapping, toResolvedPolicySet, buildCoaMappingFromRules } from '../src/store/policyStore.js';
import { evaluate, leafHash, type JournalEntry } from '../src/deps/rulesEngine.js';
import { buildSnapshot, InMemorySnapshotRepo } from '../src/deps/snapshotSvc.js';
import { prepareAnchor, confirmAnchor } from '../src/http/anchorService.js';
import { makeGeminiClient } from '../src/ai/geminiClient.js';
import { classifyEvent } from '../src/ai/classify.js';
import { makeEntityMutex } from '@subledger/anchor-svc';
import { makeGrpcAdapter } from '../src/grpcClient.js';
import { Transaction } from '@mysten/sui/transactions';
import type { FixtureBundle } from '../src/deps/ingestion.js';

async function main(): Promise<void> {
  const cfg = loadConfig();

  const hasSigner = !!cfg.suiPk;
  if (!hasSigner) {
    console.warn('[demo-e2e] SUI_PK not set — will run read-only pipeline up to anchor/prepare and skip sign+execute.');
  }

  const db = openDb(':memory:');
  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fixtures', 'acme-pilot-001.events.json',
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureBundle;
  seed(db, {
    entityId: cfg.entityId,
    entityChainId: cfg.entityChainId,
    entityCapId: cfg.entityCapId,
    originalPackageId: cfg.anchorOriginalPackageId,
  }, fixture);
  console.log('[demo-e2e] DB seeded');

  // ── 1. Classify every event ──
  const ai = makeGeminiClient(cfg.geminiApiKey);
  const periodId = '2026-Q2';

  for (const ev of listEvents(db, cfg.entityId)) {
    const r = await classifyEvent(
      { rawJson: ev.rawJson },
      { client: ai, model: cfg.aiModelClassify, threshold: cfg.aiConfidenceThreshold },
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

  // ── 3. Run rules → journal entries + lot movements ──
  // Mirror the run-rules route: sort chronologically so originating lots (OPENING_LOT, receipts)
  // persist before consumers fold them, and persist lot movements atomically alongside JEs so a
  // payment leg folds a REAL, non-empty pool instead of INSUFFICIENT_LOT-skipping.
  const eventTimeOf = (ev: { rawJson: string }) => (JSON.parse(ev.rawJson) as { eventTime: string }).eventTime;
  const approved = [
    ...listByStatus(db, cfg.entityId, 'APPROVED'),
    ...listByStatus(db, cfg.entityId, 'AUTO'),
  ].sort((a, b) => eventTimeOf(a).localeCompare(eventTimeOf(b)) || a.id.localeCompare(b.id));
  // Loaded ONCE for the demo run (Task 3 read-path switchover) — db is already seeded.
  const activePolicy = getActivePolicy(db, cfg.entityId);
  const activeCoa = getActiveCoaMapping(db, cfg.entityId);
  const enginePolicy = toResolvedPolicySet(activePolicy.doc, true);
  const engineCoa = buildCoaMappingFromRules(activeCoa.rules);
  for (const ev of approved) {
    // Fresh in-memory DB — the demo period is never locked here.
    const out = evaluate(buildRuleInput(ev, { periodId, periodOpen: true, lots: lotsForEvent(db, ev), policySet: enginePolicy, coaMapping: engineCoa }));
    if (out.decision !== 'POSTABLE') {
      // Fail loud: the curated fixture is all happy-path, a skip here means a real regression.
      throw new Error(`demo-e2e: expected POSTABLE for ${ev.id} but got ${out.decision} ${JSON.stringify(out.exceptions)}`);
    }
    const acquireStamp = `${eventTimeOf(ev)}|${ev.id}`;
    // JE + movements + status flip are one atomic unit — a movement failure rolls the JE back too.
    const persist = db.transaction(() => {
      let anchorJeId: string | null = null;
      for (const je of out.journalEntries) {
        const jeId = `je-${ev.id}-${je.idempotencyKey}`;
        insertJournalEntry(db, {
          id: jeId,
          entityId: cfg.entityId,
          eventId: ev.id,
          jeJson: JSON.stringify(je),
          idempotencyKey: je.idempotencyKey,
          leafHash: leafHash(je),
          periodId: ev.periodId ?? periodId,
        });
        if (anchorJeId === null) anchorJeId = jeId;
      }
      const anchorKey = out.journalEntries[0]?.idempotencyKey ?? ev.id;
      for (const m of out.lotMovements) {
        const isAcquire = !m.deltaQtyMinor.startsWith('-');
        insertLotMovement(db, {
          id: `lm-${anchorKey}-${m.lotId}`,
          entityId: ev.entityId, eventId: ev.id, jeId: anchorJeId,
          lotId: m.lotId, lotSeq: isAcquire ? acquireStamp : acquireLotSeq(db, ev.entityId, m.lotId),
          periodId: ev.periodId ?? periodId, coinType: m.coinType, wallet: m.wallet,
          deltaQtyMinor: m.deltaQtyMinor, deltaCostMinor: m.deltaCostMinor,
          costBasisMethod: 'FIFO', policySetVersion: activePolicy.doc.policySetVersion,
          idempotencyKey: `${anchorKey}|${m.lotId}`,
        });
      }
      markPosted(db, ev.id);
    });
    persist();
    console.log(`  posted ${ev.id}: ${out.journalEntries.length} JE(s), ${out.lotMovements.length} movement(s)`);
  }

  const jeRows = listJournal(db, cfg.entityId);
  if (jeRows.length === 0) throw new Error('no journal entries posted — fix buildRuleInput / fixture data');
  const jes: JournalEntry[] = jeRows.map((r) => JSON.parse(r.jeJson) as JournalEntry);
  console.log(`[demo-e2e] ${jes.length} journal entries`);

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
    seq: auditSnapshot.seq,
    manifestJson: JSON.stringify(auditSnapshot.manifest),
    manifestHash: auditSnapshot.manifestHash,
    merkleRoot: auditSnapshot.merkleRoot,
    leafCount: auditSnapshot.leafCount,
    supersedesSeq: auditSnapshot.supersedesSeq,
  });
  console.log(`[demo-e2e] snapshot ${snapId} (seq=${auditSnapshot.seq}, leaves=${auditSnapshot.leafCount})`);

  // ── 5. Wire gRPC adapter ──
  const { adapter, grpc, walletAddress } = makeGrpcAdapter(cfg);
  if (!walletAddress) {
    // Read-only: still call prepareAnchor to confirm the on-chain state reads work
    console.warn('[demo-e2e] No signer — calling prepareAnchor in read-only mode (walletAddress spoofed from cap owner)');
    let ownerAddr: string;
    try {
      ownerAddr = await adapter.getCapOwner(cfg.entityCapId);
      console.log(`[demo-e2e] cap owner (read from chain): ${ownerAddr}`);
    } catch (e) {
      console.error('[demo-e2e] getCapOwner failed:', e);
      console.warn('[demo-e2e] Pipeline halted at cap-owner read. Remaining steps require SUI_PK.');
      return;
    }
    const mutex = makeEntityMutex();
    const prep = await prepareAnchor(
      { db, adapter, mutex, cfg },
      { entityId: cfg.entityId, snapshotId: snapId, walletAddress: ownerAddr },
    );
    console.log(`[demo-e2e] prepareAnchor OK — expectedSeq=${prep.expectedSeq} chainId=${prep.chainId}`);
    console.log('[demo-e2e] ⚠️  SUI_PK not set — skipping sign+execute+confirm. Set SUI_PK to run the full write path.');
    return;
  }

  const mutex = makeEntityMutex();
  const ad = { db, adapter, mutex, cfg };

  // ── 6. prepare ──
  const prep = await prepareAnchor(ad, { entityId: cfg.entityId, snapshotId: snapId, walletAddress });
  console.log(`[demo-e2e] prepareAnchor OK — expectedSeq=${prep.expectedSeq}`);

  // ── 7. sign + execute ──
  const tx = Transaction.from(prep.txKind);
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
  const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');
  const { secretKey } = decodeSuiPrivateKey(cfg.suiPk!);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);

  const result = await grpc.signAndExecuteTransaction({ transaction: tx, signer: keypair });
  const digest = (result as Record<string, unknown>)?.['digest'] as string | undefined;
  if (!digest) throw new Error('no digest from signAndExecuteTransaction');
  console.log(`[demo-e2e] signed+executed digest=${digest}`);

  // ── 8. confirm ──
  const anchor = await confirmAnchor(ad, { entityId: cfg.entityId, snapshotId: snapId, digest, expectedSeq: prep.expectedSeq });
  console.log(`\n✅ ANCHORED`);
  console.log(`   seq        : ${anchor.seq}`);
  console.log(`   link       : ${anchor.link}`);
  console.log(`   digest     : ${anchor.digest}`);
  console.log(`   explorer   : ${anchor.explorerUrl}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[demo-e2e] FATAL:', e); process.exit(1); });
