/**
 * demo-e2e.ts — drives the full close-the-period pipeline in-process.
 *
 * Prerequisites for the FULL write path (anchor on-chain):
 *   SUI_PK   — Sui private key (suiprivkey… bech32) of the wallet that owns:
 *                - AnchorCap 0x266e7c8ea0b27ad52080074c9f6c1f73ec8a6ea9dd9a68d310b7cf56262dfba9
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
import { insertSnapshot } from '../src/store/snapshotStore.js';
import { buildRuleInput } from '../src/http/buildRuleInput.js';
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

  // ── 3. Run rules → journal entries ──
  const approved = [
    ...listByStatus(db, cfg.entityId, 'APPROVED'),
    ...listByStatus(db, cfg.entityId, 'AUTO'),
  ];
  for (const ev of approved) {
    const out = evaluate(buildRuleInput(ev, { periodId }));
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
    manifestJson: JSON.stringify(auditSnapshot.manifest),
    manifestHash: auditSnapshot.manifestHash,
    merkleRoot: auditSnapshot.merkleRoot,
    leafCount: auditSnapshot.leafCount,
    supersedesSeq: auditSnapshot.supersedesSeq,
  });
  console.log(`[demo-e2e] snapshot ${snapId} (seq=${auditSnapshot.seq}, leaves=${auditSnapshot.leafCount})`);

  // ── 5. Wire gRPC adapter ──
  const { adapter, walletAddress } = makeGrpcAdapter(cfg);
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
  const { grpc } = makeGrpcAdapter(cfg);
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
