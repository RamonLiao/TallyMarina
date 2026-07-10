import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertJournalEntry } from '../src/store/journalStore.js';
import { insertEvent } from '../src/store/eventStore.js';
import { insertAssetIfAbsent } from '../src/assets/store.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { loadConfig } from '../src/config.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';

// GET /entities/:id/journal must join the asset registry onto each JE line as origDecimals /
// origSource so the export can stamp an exact scaled quantity — and so it can refuse to build
// when a held asset has no registered scale. These fields are ADDITIVE and must never be a
// default: an unregistered or asset-less leg reads null, never a fabricated scale (spec D6).

const ENTITY = 'e1';
const SUI_LONG = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC_UNREG = '0xbeef::usdc::USDC';

const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'https://grpc', ANCHOR_PACKAGE_ID: '0xpkg',
  ANCHOR_ORIGINAL_PACKAGE_ID: '0xpkg', ENTITY_ID: ENTITY,
  ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm1', AI_MODEL_COPILOT: 'm2',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});
const nullClient: GeminiClient = { async generateJson() { throw new Error('not used'); } };

interface DtoLine { origCoinType: string | null; origDecimals: number | null; origSource: string | null }

// One JE with three legs: a registered-asset DEBIT, an unregistered-asset DEBIT, and a fiat
// CREDIT with no asset. je_json is crafted directly so the DTO enrichment is exercised in
// isolation from the rules engine (which the ingest asset-gate would otherwise block).
function seedJe(db: Db): void {
  const je = {
    idempotencyKey: 'ik1', lineageHash: 'lh1', reversalOf: null,
    lines: [
      { account: 'DigitalAssets', side: 'DEBIT', amountMinor: '100', origCoinType: '0x2::sui::SUI', origQtyMinor: '1200000000', priceRef: null, fxRef: null, leg: 'ACQUISITION' },
      { account: 'DigitalAssets', side: 'DEBIT', amountMinor: '50', origCoinType: USDC_UNREG, origQtyMinor: '5000000', priceRef: null, fxRef: null, leg: 'ACQUISITION' },
      { account: 'Equity', side: 'CREDIT', amountMinor: '150', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'OPENING_EQUITY' },
    ],
  };
  insertEvent(db, { id: 'ev1', entityId: ENTITY, rawJson: JSON.stringify({ eventTime: '2026-04-01T00:00:00Z', wallet: '0xw' }) });
  insertJournalEntry(db, {
    id: 'je1', entityId: ENTITY, eventId: 'ev1', jeJson: JSON.stringify(je),
    idempotencyKey: 'ik1', leafHash: 'leaf-je1', periodId: '2026-Q2',
  });
}

let app: FastifyInstance;
let db: Db;

beforeEach(async () => {
  db = openDb(':memory:');
  insertEntity(db, { id: ENTITY, displayName: 'E1', chainObjectId: '0xc', capObjectId: '0xcap', originalPackageId: '0xpkg' });
  // Register SUI only (canonical long form). USDC deliberately left unregistered.
  insertAssetIfAbsent(db, {
    entityId: ENTITY, coinType: SUI_LONG, decimals: 9, symbol: 'SUI', displayName: 'Sui',
    source: 'chain', chainObjectId: '0xm', metadataCapState: 'DELETED', fetchedAt: 't',
    decidedBy: null, reason: null, createdAt: 't',
  });
  seedJe(db);
  app = Fastify();
  registerRoutes(app, {
    db, cfg, classifyClient: nullClient, copilotClient: nullClient,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    memory: new OffMemory(),
  });
  await app.ready();
});

async function lines(): Promise<DtoLine[]> {
  const r = await app.inject({ method: 'GET', url: `/entities/${ENTITY}/journal` });
  expect(r.statusCode).toBe(200);
  const body = r.json() as { journal: Array<{ je: { lines: DtoLine[] } }> };
  return body.journal[0]!.je.lines;
}

describe('GET /journal decimals join', () => {
  it('stamps a registered asset leg with its real decimals and source (short form matches canonical key)', async () => {
    // WHY (V2): the event payload carries the short form 0x2::sui::SUI; the registry stores the
    // canonical long form. getAssetDecimals canonicalizes before lookup so the join still hits.
    const sui = (await lines()).find((l) => l.origCoinType === '0x2::sui::SUI')!;
    expect(sui.origDecimals).toBe(9);
    expect(sui.origSource).toBe('chain');
  });

  it('leaves an unregistered asset leg at null decimals — never a fabricated default', async () => {
    // WHY: this null IS the export's fail-closed trigger. A default here (e.g. 9) would silently
    // ship a USDC quantity mis-scaled by 1000x — the exact bug the whole registry exists to kill.
    const usdc = (await lines()).find((l) => l.origCoinType === USDC_UNREG)!;
    expect(usdc.origDecimals).toBeNull();
    expect(usdc.origSource).toBeNull();
  });

  it('leaves a fiat/asset-less leg at null decimals and source', async () => {
    const fiat = (await lines()).find((l) => l.origCoinType === null)!;
    expect(fiat.origDecimals).toBeNull();
    expect(fiat.origSource).toBeNull();
  });

  it('does not disturb the existing line fields (additive only)', async () => {
    const sui = (await lines()).find((l) => l.origCoinType === '0x2::sui::SUI')! as DtoLine & Record<string, unknown>;
    expect(sui.account).toBe('DigitalAssets');
    expect(sui.origQtyMinor).toBe('1200000000');
    expect(sui.leg).toBe('ACQUISITION');
  });
});
