// Task 6: period-end revaluation orchestration (spec §6) — the shared core behind
// GET /entities/:id/revaluation/preview and POST /entities/:id/revaluation/run.
//
// Cross-task contracts honored here (do not "simplify" these away):
// - Basis dispatch is PER COIN (contract #1): IFRS → one IFRS_COST group; US_GAAP →
//   asu202308Applies[coin]===true → GAAP_FV, else GAAP_COST. One revalueLots call per group,
//   same keyBase.
// - transitionMode (contract #2): true ONLY for the GAAP_FV group of an entity that has
//   NEVER emitted any seq-0 lot_valuation row. An already-transitioned entity must never
//   send true again — the engine's `reval-open:` key is constant per (entity, coin), so a
//   second emission would be dedup-swallowed by the ledger (amount lost, no exception).
// - Draft seq overwrite (contract #3): engine seq>=1 drafts are placeholders; persist them
//   as THIS run's seq (per-lot seq monotonicity). seq-0 transition drafts keep 0.
// - All-or-nothing (contract #4): any held coin without a cut-off price OR without registry
//   decimals 400s the WHOLE run. Preview never 400s on this; it reports `priceMissing`.
// - Dual fingerprints (contract #5): run header records priceSetHash over EXACTLY the price
//   rows this run consumes (held coins only) + lotSetHash over the folded lots.
// - Replay gate (contract #6): latestRun with identical fingerprints AND identical policy
//   version → 409 REVAL_ALREADY_CURRENT.
// - Rerun (contract #7): reversal JE per old `reval:` JE (Dr/Cr swapped, key bound to the
//   OLD run id) → supersedeValuationsOfRun (seq>0 only) → new run, all in ONE transaction.
//   `reval-open:` JEs are NOT reversed: the pinned reversal key `reval-rev:${oldRunId}:
//   ${coinType}` would collide with the `reval:` reversal of the same coin, and the
//   cumulative-effect transition is permanent by the same D6 invariant that keeps seq-0
//   valuation rows unsuperseded.
// - FK anchor (contract #8): one system event row `evt-reval-${runId}` per run, in the same
//   transaction; every reval/reversal JE points at it and carries an EXPLICIT periodId
//   (a NULL periodId JE never enters the period merkle).
import type { Db } from '../store/db.js';
import { ApiError } from '../http/errors.js';
import {
  revalueLots, leafHash,
  type PositionLot, type PricePoint, type ValuationBasis, type JournalEntry, type RevalueOutput,
} from '../deps/rulesEngine.js';
import { latestPricesAt, periodCutoff, priceSetHash, type PricePointRow } from '../store/pricePointStore.js';
import {
  insertRun, latestRun, insertValuation, supersedeValuationsOfRun, foldValuationStates, lotSetHash,
  valuedLotIdsOfRun,
  type RevaluationRunRow,
} from '../store/revaluationStore.js';
import { getActivePolicy, type PolicyDoc } from '../store/policyStore.js';
import { foldAllRemainingLots } from '../store/lotMovementStore.js';
import { insertJournalEntry, listJournal } from '../store/journalStore.js';
import { getAssetDecimals } from '../assets/registry.js';
import { canonicalCoinType } from '../assets/normalize.js';

export interface BasisGroup { basis: ValuationBasis; lots: PositionLot[] }

export interface RevaluationContext {
  entityId: string;
  periodId: string;
  asOf: string;
  lots: PositionLot[];                        // all remaining lots, entity-wide
  prices: PricePointRow[];                    // exactly the rows this run consumes (held+priced coins)
  enginePrices: PricePoint[];                 // same rows, mapped to the engine's PricePoint shape
  decimalsByCoin: Record<string, number>;
  priceMissing: string[];                     // held coins lacking a cut-off price OR registry decimals
  priceSetHash: string;
  lotSetHash: string;
  policyVersion: number;
  doc: PolicyDoc;
  groups: BasisGroup[];                       // per-coin basis dispatch (contract #1)
  latest: RevaluationRunRow | null;
}

// NOTE on shape vs the brief: `valuations` is deliberately NOT part of the context.
// foldValuationStates fails loud on mixed-basis rows (CPA B2), and after a policy switch the
// unsuperseded rows still carry the OLD basis until the rerun supersedes them — so the fold
// can only run INSIDE the run transaction, after supersedeValuationsOfRun. transitionMode is
// likewise decided in-transaction (it reads seq-0 existence, which supersede never changes).

// Exported for Task 10 (disposal release, spec §4.5): lotsForEvent needs the SAME per-coin
// basis dispatch a revaluation run used, so foldValuationStates' expectedBasis guard (CPA B2)
// reads the same rows a run wrote. Do not fork a second copy of this dispatch rule.
export function basisOf(doc: PolicyDoc, coinType: string): ValuationBasis {
  if (doc.accountingStandard === 'IFRS') return 'IFRS_COST';
  return doc.asu202308Applies[coinType] === true ? 'GAAP_FV' : 'GAAP_COST';
}

function dispatchGroups(doc: PolicyDoc, lots: PositionLot[]): BasisGroup[] {
  const byBasis = new Map<ValuationBasis, PositionLot[]>();
  for (const lot of lots) {
    const basis = basisOf(doc, lot.coinType);
    const arr = byBasis.get(basis);
    if (arr) arr.push(lot); else byBasis.set(basis, [lot]);
  }
  return [...byBasis.entries()].map(([basis, groupLots]) => ({ basis, lots: groupLots }));
}

export function loadRevaluationContext(db: Db, entityId: string, periodId: string): RevaluationContext {
  let asOf: string;
  try {
    asOf = periodCutoff(periodId);
  } catch {
    throw new ApiError(400, 'VALIDATION', `unknown period ${periodId}`);
  }
  const { version: policyVersion, doc } = getActivePolicy(db, entityId);
  const lots = foldAllRemainingLots(db, entityId);
  const heldCoins = [...new Set(lots.map((l) => l.coinType))].sort();

  // Price rows persist the CANONICAL long-form coinType (the price route canonicalizes on
  // write); lot_movement keeps the coinType as the event carried it (possibly short form).
  // Match via canonicalization, but hand the engine the LOT's spelling — revalueLots joins
  // prices to lots by exact coinType equality.
  const priceByCanon = new Map(latestPricesAt(db, entityId, asOf).map((p) => [p.coinType, p]));
  const consumed: PricePointRow[] = [];
  const enginePrices: PricePoint[] = [];
  const decimalsByCoin: Record<string, number> = {};
  const priceMissing: string[] = [];
  for (const coin of heldCoins) {
    let canon: string;
    try {
      canon = canonicalCoinType(coin);
    } catch {
      priceMissing.push(coin); // unparseable coinType can never have a valid price — fail closed
      continue;
    }
    const px = priceByCanon.get(canon);
    const asset = getAssetDecimals(db, entityId, coin);
    // Registry gap = same fail-closed state as a missing price (contract #4): a value at an
    // unknown scale is a lie, never a default.
    if (!px || asset === null) { priceMissing.push(coin); continue; }
    consumed.push(px);
    enginePrices.push({ id: px.id, coinType: coin, priceCurrency: px.quoteCurrency, asOfDate: px.asOf, unitPriceMinor: px.priceMinor });
    decimalsByCoin[coin] = asset.decimals;
  }

  return {
    entityId, periodId, asOf, lots,
    prices: consumed,
    enginePrices,
    decimalsByCoin, priceMissing,
    priceSetHash: priceSetHash(consumed),
    lotSetHash: lotSetHash(lots),
    policyVersion, doc,
    groups: dispatchGroups(doc, lots),
    latest: latestRun(db, entityId, periodId),
  };
}

// Build the Dr/Cr-swapped reversal drafts for the old run's `reval:` JEs. Reads the original
// JE text back from journal_entries.je_json (contract #7). `reval-open:` and `reval-rev:`
// keys are excluded by the exact-prefix match — see the module header for why. `reverseCoins`
// is the LOT-LEVEL decision computed by the caller: a coin appears iff at least one lot the old
// run valued still survives into this run's fold.
function reversalDrafts(db: Db, entityId: string, oldRun: RevaluationRunRow, reverseCoins: Set<string>): JournalEntry[] {
  const evtId = `evt-reval-${oldRun.id}`;
  return listJournal(db, entityId, oldRun.periodId)
    .filter((r) => r.eventId === evtId && r.idempotencyKey.startsWith('reval:'))
    .map((r) => {
      const je = JSON.parse(r.jeJson) as JournalEntry;
      const coinType = je.lines[0]?.origCoinType;
      if (!coinType) throw new Error(`reversalDrafts: reval JE ${r.id} has no origCoinType — cannot key its reversal`);
      return { je, coinType };
    })
    // C1 / Task 13 (re-review critical): the reverse-or-skip decision is LOT-LEVEL, not
    // coin-level. `reverseCoins` holds exactly the coins for which at least one of the OLD
    // RUN'S valued lots survives into this run's fold (see valuedLotIdsOfRun + the caller).
    //   - Coin with a surviving old-run lot → reverse IN FULL: the new run's fresh reval (fed by
    //     a fold whose surviving DISPOSAL_RELEASE row on that SAME lot nets out any disposed
    //     delta) re-establishes correct carrying, so full reversal + fresh reval nets to fair
    //     value across any intervening PARTIAL disposal (series A).
    //   - Coin whose old-run lots were ALL disposed → skip. Its old reval was already
    //     reclassified to realized on disposal; reversing it drove DigitalAssets negative
    //     (series B) OR — the coin-level trap — silently dropped R2 when the coin was RE-ACQUIRED
    //     as a fresh lot before the rerun (series C): heldCoins.has(coin) was true, so the
    //     disposed lot's reval got reversed against the fresh lot's carrying. The fresh lot
    //     starts from cost via its own reval, so no reversal is owed.
    .filter(({ coinType }) => reverseCoins.has(coinType))
    .map(({ je, coinType }) => ({
      idempotencyKey: `reval-rev:${oldRun.id}:${coinType}`,
      lineageHash: je.lineageHash,
      lines: je.lines.map((l) => ({ ...l, side: l.side === 'DEBIT' ? 'CREDIT' as const : 'DEBIT' as const })),
      reversalOf: je.idempotencyKey,
    }));
}

interface GroupOutput { basis: ValuationBasis; lots: PositionLot[]; out: RevalueOutput }
interface ComputedRun { run: RevaluationRunRow; keyBase: string; reversalJes: JournalEntry[]; groups: GroupOutput[] }

// The shared write-path core. MUST run inside a db.transaction owned by the caller:
// executeRun commits it; previewRun throws PreviewRollback to abort it (zero net writes).
function computeRunInTxn(db: Db, ctx: RevaluationContext): ComputedRun {
  const run = insertRun(db, {
    entityId: ctx.entityId, periodId: ctx.periodId,
    priceSetHash: ctx.priceSetHash, lotSetHash: ctx.lotSetHash,
    policySetVersion: ctx.doc.policySetVersion, accountingStandard: ctx.doc.accountingStandard,
    reversalOfRunId: ctx.latest?.id ?? null,
  });
  // Lot-level reversal decision (Task 13): map each of the OLD run's valued lots to its coin
  // VIA THE CURRENT FOLD. foldAllRemainingLots drops fully-disposed lots (qty 0), so a coin
  // lands in reverseCoins iff at least one lot it was valued for still survives. A re-acquired
  // fresh lot shares the coinType but is NOT among the old run's valued lots, so it can never
  // resurrect a skip into a reversal.
  const coinByRemainingLot = new Map(ctx.lots.map((l) => [l.lotId, l.coinType]));
  const reverseCoins = new Set<string>();
  if (ctx.latest) {
    for (const lotId of valuedLotIdsOfRun(db, ctx.entityId, ctx.latest.id)) {
      const coin = coinByRemainingLot.get(lotId);
      if (coin !== undefined) reverseCoins.add(coin);
    }
  }
  const reversalJes = ctx.latest ? reversalDrafts(db, ctx.entityId, ctx.latest, reverseCoins) : [];
  if (ctx.latest) supersedeValuationsOfRun(db, ctx.latest.id, run.id);

  // Contract #2: entity-level, not per-lot. seq-0 rows are permanent (never superseded), so
  // this read is stable across reruns and immune to the supersede above.
  const transitioned = db.prepare(
    'SELECT 1 FROM lot_valuation WHERE entity_id = ? AND seq = 0 LIMIT 1',
  ).get(ctx.entityId) !== undefined;

  const keyBase = `${ctx.entityId}:${ctx.periodId}:${run.seq}`;
  const groups: GroupOutput[] = ctx.groups.map((g) => {
    // Fold AFTER supersede: the old run's rows (possibly a different basis after a policy
    // switch) are out of the unsuperseded set by now, so the mixed-basis guard holds.
    const valuations = foldValuationStates(db, ctx.entityId, g.lots.map((l) => l.lotId), g.basis);
    const out = revalueLots({
      basis: g.basis, entityId: ctx.entityId, periodId: ctx.periodId, keyBase,
      lots: g.lots, valuations, prices: ctx.enginePrices, decimalsByCoin: ctx.decimalsByCoin,
      policySetVersion: ctx.doc.policySetVersion,
      transitionMode: g.basis === 'GAAP_FV' && !transitioned,
    });
    return { basis: g.basis, lots: g.lots, out };
  });
  return { run, keyBase, reversalJes, groups };
}

export interface ExecuteRunResult { runId: string; jeIds: string[]; reversedRunId: string | null }

export function executeRun(db: Db, entityId: string, periodId: string): ExecuteRunResult {
  const ctx = loadRevaluationContext(db, entityId, periodId);
  if (ctx.priceMissing.length > 0) {
    // Contract #4: one unpriced (or unregistered) coin fails the WHOLE run — a partially
    // revalued period is a CPA-rejected artifact, not a partial success.
    throw new ApiError(400, 'PRICE_MISSING', `no period cut-off price / registered decimals for: ${ctx.priceMissing.join(', ')}`);
  }
  if (ctx.latest
    && ctx.latest.priceSetHash === ctx.priceSetHash
    && ctx.latest.lotSetHash === ctx.lotSetHash
    && ctx.latest.policySetVersion === ctx.doc.policySetVersion) {
    throw new ApiError(409, 'REVAL_ALREADY_CURRENT',
      `run ${ctx.latest.id} already reflects the current prices, lots, and policy version ${ctx.doc.policySetVersion}`);
  }

  let result: ExecuteRunResult | null = null;
  const txn = db.transaction(() => {
    const { run, keyBase, reversalJes, groups } = computeRunInTxn(db, ctx);

    // FK anchor + audit anchor (contract #8): a system event row this run's JEs hang off.
    // status 'SYSTEM' is deliberately outside the event state machine's 5-status vocabulary so
    // no classifier/run-rules/simulation scan ever picks it up; wallet is required by the
    // recon movement walker (which then no-ops: reval JE lines carry no origQtyMinor).
    const evtId = `evt-reval-${run.id}`;
    const header = {
      eventType: 'REVALUATION_RUN', wallet: 'system', coinType: 'system',
      eventTime: `${ctx.asOf}T00:00:00Z`,
      runId: run.id, periodId: ctx.periodId, seq: run.seq,
      priceSetHash: ctx.priceSetHash, lotSetHash: ctx.lotSetHash,
      policySetVersion: ctx.doc.policySetVersion, accountingStandard: ctx.doc.accountingStandard,
      reversalOfRunId: ctx.latest?.id ?? null,
    };
    db.prepare(
      `INSERT INTO events (id, entity_id, raw_json, status, period_id, final_event_type)
       VALUES (?, ?, ?, 'SYSTEM', ?, 'REVALUATION_RUN')`,
    ).run(evtId, ctx.entityId, JSON.stringify(header), ctx.periodId);

    const jeIds: string[] = [];
    const insertJe = (je: JournalEntry): string => {
      const id = `je-${evtId}-${je.idempotencyKey}`;
      const res = insertJournalEntry(db, {
        id, entityId: ctx.entityId, eventId: evtId,
        jeJson: JSON.stringify(je), idempotencyKey: je.idempotencyKey, leafHash: leafHash(je),
        periodId: ctx.periodId,                     // EXPLICIT — merkle membership (contract #8)
        policySetVersion: ctx.doc.policySetVersion, ruleVersion: ctx.doc.ruleVersion,
      });
      if (res === 'inserted') jeIds.push(id);
      return id;
    };

    for (const rj of reversalJes) insertJe(rj);

    for (const g of groups) {
      if (g.out.exceptions.length > 0) {
        // The PRICE_MISSING gate ran before this transaction; exceptions here mean the gate
        // and the engine disagree — fail loud, roll everything back (Rule 12).
        throw new Error(`executeRun: revalueLots reported exceptions after the PRICE_MISSING gate: ${JSON.stringify(g.out.exceptions)}`);
      }
      const jeIdByKey = new Map<string, string>();
      for (const je of g.out.journalEntries) jeIdByKey.set(je.idempotencyKey, insertJe(je));
      const coinOf = new Map(g.lots.map((l) => [l.lotId, l.coinType]));
      for (const d of g.out.valuations) {
        const coinType = coinOf.get(d.lotId);
        if (!coinType) throw new Error(`executeRun: valuation draft for unknown lot ${d.lotId}`);
        // A draft's JE (when one exists) is the coin's transition JE for OPENING_FV rows,
        // else the coin's period JE. Netting can zero a coin's JE while per-lot drafts
        // remain — jeId is honestly null then.
        const jeKey = d.reason === 'OPENING_FV'
          ? `reval-open:${ctx.entityId}:${coinType}`
          : `reval:${keyBase}:${coinType}`;
        insertValuation(db, {
          entityId: ctx.entityId, lotId: d.lotId, periodId: ctx.periodId, runId: run.id,
          seq: d.seq === 0 ? 0 : run.seq,           // contract #3: overwrite placeholder with run seq
          basis: d.basis, qtyMinor: d.qtyMinor,
          priorCarryingMinor: d.priorCarryingMinor, currentValueMinor: d.currentValueMinor,
          deltaMinor: d.deltaMinor, pricePointId: d.pricePointId,
          jeId: jeIdByKey.get(jeKey) ?? null, reason: d.reason,
          policySetVersion: ctx.doc.policySetVersion, supersededBy: null,
        });
      }
    }
    result = { runId: run.id, jeIds, reversedRunId: ctx.latest?.id ?? null };
  });
  txn();
  if (result === null) throw new Error('executeRun: transaction completed without a result');
  return result;
}

// ---------- preview ----------

export interface PreviewLotRow {
  lotId: string; qtyMinor: string; priorCarryingMinor: string; currentValueMinor: string; deltaMinor: string;
}
export interface PreviewRow {
  coinType: string; basis: ValuationBasis;
  priorCarryingMinor: string; currentValueMinor: string; deltaMinor: string;
  missingPrice: boolean; lots: PreviewLotRow[];
}
export interface PreviewDTO {
  rows: PreviewRow[];
  journalDraft: Array<{ account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }>;
  priceMissing: string[];
}

// Control-flow exception: aborts the sandbox transaction so previewRun leaves ZERO net
// writes, while still exercising the exact run code path (insertRun seq, supersede-then-fold,
// transitionMode) a real run would take. better-sqlite3 rolls back on throw.
class PreviewRollback extends Error {
  constructor(readonly dto: PreviewDTO) { super('preview rollback'); this.name = 'PreviewRollback'; }
}

function buildPreviewDTO(ctx: RevaluationContext, reversalJes: JournalEntry[], groups: GroupOutput[]): PreviewDTO {
  // Per-lot rows come straight from the engine's drafts (seq-0 transition drafts included —
  // they are real cumulative-effect adjustments). A lot with no draft has no adjustment this
  // run; a coin whose drafts are empty aggregates to zeros ("no change"), never invented
  // carrying values — computing carrying here would duplicate the engine's impairment math.
  const draftsByCoin = new Map<string, PreviewLotRow[]>();
  for (const g of groups) {
    const coinOf = new Map(g.lots.map((l) => [l.lotId, l.coinType]));
    for (const d of g.out.valuations) {
      const coinType = coinOf.get(d.lotId)!;
      const arr = draftsByCoin.get(coinType) ?? [];
      arr.push({
        lotId: d.lotId, qtyMinor: d.qtyMinor,
        priorCarryingMinor: d.priorCarryingMinor, currentValueMinor: d.currentValueMinor, deltaMinor: d.deltaMinor,
      });
      draftsByCoin.set(coinType, arr);
    }
  }
  const heldCoins = [...new Set(ctx.lots.map((l) => l.coinType))].sort();
  const missing = new Set(ctx.priceMissing);
  const rows: PreviewRow[] = heldCoins.map((coinType) => {
    const basis = basisOf(ctx.doc, coinType);
    if (missing.has(coinType)) {
      return { coinType, basis, priorCarryingMinor: '0', currentValueMinor: '0', deltaMinor: '0', missingPrice: true, lots: [] };
    }
    const lots = draftsByCoin.get(coinType) ?? [];
    const sum = (f: (l: PreviewLotRow) => string): string =>
      lots.reduce((acc, l) => acc + BigInt(f(l)), 0n).toString();
    return {
      coinType, basis,
      priorCarryingMinor: sum((l) => l.priorCarryingMinor),
      currentValueMinor: sum((l) => l.currentValueMinor),
      deltaMinor: sum((l) => l.deltaMinor),
      missingPrice: false, lots,
    };
  });
  const journalDraft = [...reversalJes, ...groups.flatMap((g) => g.out.journalEntries)]
    .flatMap((je) => je.lines.map((l) => ({ account: l.account, side: l.side, amountMinor: l.amountMinor })));
  return { rows, journalDraft, priceMissing: [...ctx.priceMissing] };
}

export function previewRun(db: Db, entityId: string, periodId: string): PreviewDTO {
  const ctx = loadRevaluationContext(db, entityId, periodId);
  try {
    db.transaction(() => {
      const { reversalJes, groups } = computeRunInTxn(db, ctx);
      // Missing-price coins: the engine already skipped them (exceptions) — preview reports
      // them in priceMissing instead of 400ing (contract #4's preview half).
      throw new PreviewRollback(buildPreviewDTO(ctx, reversalJes, groups));
    })();
  } catch (e) {
    if (e instanceof PreviewRollback) return e.dto;
    throw e;
  }
  throw new Error('previewRun: sandbox transaction returned without rollback');
}
