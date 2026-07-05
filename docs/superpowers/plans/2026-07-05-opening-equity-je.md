# Opening-Equity JE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Non-zero-cost OPENING_LOT events emit a `Dr DigitalAssets / Cr OpeningBalanceEquity` journal entry so opening lots enter the merkle spine; tie-out moves to the original-basis identity; the lots DTO discloses anchoring via `acquireJeId`.

**Architecture:** The rules engine's `openingLotStrategy.buildJeLines` emits the JE (spec D3) so it flows through the existing COA resolution, engine idempotency key, merkle leaf codec, and the atomic JE+movements+markPosted transaction — zero persist-layer changes expected. Zero-basis lots (`'0'`) keep the JE-less path (spec D2). Forward-only: no migration; legacy rows keep `je_id NULL` (spec D1/D4).

**Tech Stack:** TypeScript, vitest, better-sqlite3, zod. No Move changes (`sui move test` not applicable — stated, not skipped).

**Spec:** `docs/superpowers/specs/2026-07-05-opening-equity-je-design.md` (read §2 decisions + §3 before starting any task).

## Global Constraints

- `openingCostMinor` is **functional-currency (USD) minor units of historical cost** (spec §3.1) — never native-token units.
- Zero-basis (`openingCostMinor === '0'`) → NO JE, movement-only, `je_id NULL` (D2).
- Forward-only: never touch persisted legacy rows; no migration scripts (D1).
- JE idempotency key = engine-standard `idempotencyKey(input, null)` sha256 — do NOT invent a literal key (spec §3.3; the `${eventId}|OPEN` idea was reviewed and rejected as unimplementable).
- Lots DTO `origin` stays `'opening' | 'derived'` — a three-way enum is a breaking change (spec §3.5b).
- New account name: `OpeningBalanceEquity`. New leg name: `OPENING_EQUITY`.
- Git: stage only explicitly named files (`git add <file>...`), never `git add -A`.
- After unit+integration tests, monkey tests are mandatory (repo rule).

---

### Task 1: Rules engine — openingLotStrategy emits the opening JE

**Files:**
- Modify: `services/rules-engine/src/rules/openingLotRules.ts`
- Test: `services/rules-engine/test/rules/openingLot.test.ts`

**Interfaces:**
- Consumes: `balanceCheck(lines)` from `./receiptRules.js`; `ctx.input.coaMapping.resolve({ eventType, leg, coinType })` returns `string | null`.
- Produces: for non-zero `openingCostMinor`, `evaluate()` output has `journalEntries.length === 1` with two lines — `{ leg: 'ACQUISITION', side: 'DEBIT', amountMinor: cost, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null }` and `{ leg: 'OPENING_EQUITY', side: 'CREDIT', amountMinor: cost, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null }`. For `'0'`: `journalEntries.length === 0` (unchanged). Tasks 2–5 rely on exactly these leg names.

- [ ] **Step 1: Update the test file — failing tests first**

In `services/rules-engine/test/rules/openingLot.test.ts`:

(a) extend the `coa` stub so `OPENING_EQUITY` resolves:

```ts
const coa: CoaMapping = {
  resolve: ({ leg }) => {
    if (leg === 'ACQUISITION') return 'ASSET-SUI';
    if (leg === 'RECEIVABLE_SETTLEMENT') return 'AR';
    if (leg === 'OPENING_EQUITY') return 'OBE';
    return null;
  },
};
```

(b) REPLACE the first test (`'originates a lot: POSTABLE, one positive movement, NO journal entry (spec §3)'`) with:

```ts
it('originates a lot AND emits the opening-equity JE (opening-equity-je spec §3.1)', () => {
  const out = evaluate(openingInput());
  expect(out.decision).toBe('POSTABLE');
  expect(out.lotMovements).toHaveLength(1);
  expect(out.lotMovements[0]!.deltaCostMinor).toBe('2500000'); // historical cost, NOT repriced
  // The JE is what puts the opening basis into the merkle spine (evidence gap closed).
  expect(out.journalEntries).toHaveLength(1);
  const je = out.journalEntries[0]!;
  expect(je.idempotencyKey).toBeTruthy(); // engine-standard key, assigned by index.ts
  const dr = je.lines.find((l) => l.side === 'DEBIT')!;
  const cr = je.lines.find((l) => l.side === 'CREDIT')!;
  expect(dr).toMatchObject({ account: 'ASSET-SUI', leg: 'ACQUISITION', amountMinor: '2500000',
    origCoinType: '0x2::sui::SUI', origQtyMinor: '5000000000' }); // qty+coin enter the leaf (spec §3.1/§6)
  expect(cr).toMatchObject({ account: 'OBE', leg: 'OPENING_EQUITY', amountMinor: '2500000',
    origCoinType: null, origQtyMinor: null });
});

it('MAPPING_MISSING fail-closed when the OPENING_EQUITY leg is unmapped (spec §3.2)', () => {
  const noEquity: CoaMapping = { resolve: ({ leg }) => (leg === 'ACQUISITION' ? 'ASSET-SUI' : null) };
  const out = evaluate({ ...openingInput(), coaMapping: noEquity } as RuleInput);
  expect(out.decision).not.toBe('POSTABLE');
  expect(out.exceptions.some((e) => e.code === 'MAPPING_MISSING')).toBe(true);
});
```

(c) EXTEND the zero-cost test (keep existing assertions, add):

```ts
expect(out.journalEntries).toHaveLength(0); // D2: zero basis stays JE-less, unanchored by design
```

Note: check the actual exceptions shape on the output (`out.exceptions` entries carry `code`) against a neighboring engine test (e.g. `test/phases/`) and match its assertion style if it differs.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd services/rules-engine && npx vitest run test/rules/openingLot.test.ts`
Expected: the JE-emission and MAPPING_MISSING tests FAIL (journalEntries is 0); existing fail-closed tests still PASS.

- [ ] **Step 3: Implement in `openingLotRules.ts`**

Replace the whole strategy body (keep `buildLotPlan`, `buildMeasurements`, `buildDisclosure` as-is except the cost guard):

```ts
import type { EventStrategy, LotPlan } from './registry.js';
import type { JeLine, Measurement, DisclosureFact, RuleException } from '../domain/types.js';
import { balanceCheck } from './receiptRules.js';

// OPENING_LOT (C4 spec §3 + opening-equity-je spec): originates a pre-history lot with one
// positive movement. Non-zero historical cost ALSO emits Dr <asset>/Cr <opening equity> so the
// declared basis (and qty/coinType via the leaf codec) is merkle-anchored. Zero-basis lots
// (airdrops) stay JE-less by design (spec D2) — the §7.8.3 JE-less POSTABLE branch remains.
const COST_RE = /^[0-9]+$/;

export const openingLotStrategy: EventStrategy = {
  ruleIds: ['opening-lot-origination-v1', 'opening-equity-je-v1'],
  requiresValuation: false, // historical cost comes from the event payload, never repriced
  classify: () => null,
  buildLotPlan: (ctx): LotPlan | RuleException => {
    const { event } = ctx.input;
    const cost = event.openingCostMinor;
    if (!cost || !COST_RE.test(cost)) {
      return { phase: 7, code: 'SCHEMA_INVALID', detail: 'OPENING_LOT requires openingCostMinor (non-negative integer string)' };
    }
    return {
      movements: [{
        lotId: `OPEN-${event.eventId}`, coinType: event.coinType, wallet: event.wallet,
        deltaQtyMinor: event.quantityMinor, deltaCostMinor: cost,
      }],
      consumed: [],
    };
  },
  buildMeasurements: (): Measurement[] => [],
  buildJeLines: (ctx): JeLine[] | RuleException => {
    const { event } = ctx.input;
    const cost = event.openingCostMinor;
    if (!cost || !COST_RE.test(cost)) {
      return { phase: 7, code: 'SCHEMA_INVALID', detail: 'OPENING_LOT requires openingCostMinor (non-negative integer string)' };
    }
    if (cost === '0') return []; // D2: zero-basis lots are JE-less and unanchored by design
    const assetAccount = ctx.input.coaMapping.resolve({ eventType: 'OPENING_LOT', leg: 'ACQUISITION', coinType: event.coinType });
    const equityAccount = ctx.input.coaMapping.resolve({ eventType: 'OPENING_LOT', leg: 'OPENING_EQUITY', coinType: event.coinType });
    if (!assetAccount || !equityAccount) return { phase: 9, code: 'MAPPING_MISSING', detail: { assetAccount, equityAccount } };
    return balanceCheck([
      // origCoinType/origQtyMinor follow every existing ACQUISITION leg — the leaf codec anchors
      // them, so the declared quantity and coinType are merkle-anchored too (spec §3.1).
      { account: assetAccount, side: 'DEBIT', amountMinor: cost, origCoinType: event.coinType, origQtyMinor: event.quantityMinor, priceRef: null, fxRef: null, leg: 'ACQUISITION' },
      { account: equityAccount, side: 'CREDIT', amountMinor: cost, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'OPENING_EQUITY' },
    ]);
  },
  buildDisclosure: (ctx): DisclosureFact[] =>
    [{ kind: 'opening_lot', detail: { units: ctx.input.event.quantityMinor, cost: ctx.input.event.openingCostMinor } }],
};
```

If `phase`/`code` literals mismatch the `RuleException` type, mirror the values used by `receiptRules.ts` (phase 9 MAPPING_MISSING) — do not invent new codes.

- [ ] **Step 4: Run the full rules-engine suite**

Run: `cd services/rules-engine && npx vitest run`
Expected: ALL PASS (122 baseline + edits). If golden/merkle tests fail, STOP and inspect — the opening JE should not change any existing golden fixture (no golden fixture contains OPENING_LOT with non-zero cost going through evaluate → verify before touching goldens; updating a golden requires understanding, not regeneration).

- [ ] **Step 5: Commit**

```bash
git add services/rules-engine/src/rules/openingLotRules.ts services/rules-engine/test/rules/openingLot.test.ts
git commit -m "feat(rules-engine): OPENING_LOT emits opening-equity JE for non-zero basis (spec §3.1)"
```

---

### Task 2: API — COA mappings + run-rules integration catches up

**Files:**
- Modify: `services/api/src/http/policyConstants.ts`
- Modify (test expectations only): `services/api/test/runRules.lots.test.ts`, and any other api test asserting OPENING_LOT has no JE / `je_id NULL` / posted-counter values — find them all with `grep -rn "OPENING_LOT" services/api/test services/api/scripts`.

**Interfaces:**
- Consumes: Task 1's leg names (`ACQUISITION`, `OPENING_EQUITY`).
- Produces: `resolveCoa({ eventType: 'OPENING_LOT', leg: 'ACQUISITION' }) === 'DigitalAssets'`; `resolveCoa({ eventType: 'OPENING_LOT', leg: 'OPENING_EQUITY' }) === 'OpeningBalanceEquity'`. After run-rules, a non-zero opening lot's movement row has a real `je_id` (`lm.jeId !== null`). Tasks 3–5 rely on this.

- [ ] **Step 1: Add the two COA rows**

In `DEMO_COA_RULES` (`policyConstants.ts`), after the GAS_FEE block:

```ts
  { eventType: 'OPENING_LOT', leg: 'ACQUISITION', account: 'DigitalAssets' },
  { eventType: 'OPENING_LOT', leg: 'OPENING_EQUITY', account: 'OpeningBalanceEquity' },
```

- [ ] **Step 2: Run the api suite to see what the new JE breaks**

Run: `cd services/api && npx vitest run`
Expected: failures ONLY in tests that pinned the old JE-less behavior (e.g. `runRules.lots.test.ts` asserting `jeId: null` on opening movements, posted-counter counts — opening events previously contributed 0 to `posted` because the counter counts JE inserts; now they contribute 1). List every failure before fixing any.

- [ ] **Step 3: Update each failing assertion honestly**

For each failure: the NEW expected behavior is — non-zero opening lot posts 1 JE (`Dr DigitalAssets / Cr OpeningBalanceEquity`, both `amountMinor === openingCostMinor`), its movement `jeId` is `je-<eventId>-<engineKey>`-shaped (assert `not.toBeNull()` / `toMatch(/^je-/)`, don't hardcode the sha256), and `posted` counters increase by 1 per non-zero opening event. Zero-basis expectations stay exactly as they were. Update the stale comment in `routes.ts:448-449` ("JE-less POSTABLE outputs (OPENING_LOT…)") to say the JE-less branch now applies only to zero-basis opening lots and same-wallet ITX. Do NOT change route logic — spec §3.3 predicts zero structural change; if a logic change seems needed, STOP and report.

- [ ] **Step 4: Run the api suite green**

Run: `cd services/api && npx vitest run`
Expected: ALL PASS (baseline 390 ± the edited assertions).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/http/policyConstants.ts services/api/src/http/routes.ts services/api/test/<each-updated-test-file>
git commit -m "feat(api): COA mappings for opening-equity JE; run-rules tests track the anchored opening path"
```

---

### Task 3: Lots DTO — `acquireJeId` anchoring disclosure

**Files:**
- Modify: `services/api/src/lots/dto.ts`
- Test: `services/api/test/lots.route.test.ts`

**Interfaces:**
- Consumes: `LotMovementRow.jeId: string | null` (already in DTO movement rows); Task 2's persisted `je_id`.
- Produces: every lot entry gains `acquireJeId: string | null` — real JE id for derived and JE-backed opening lots, `null` for legacy/zero-basis opening lots. This is the JOIN KEY into `GET /entities/:id/journal` (proof triple lives there; never duplicate proof fields onto lots, never rebuild idempotency keys client-side — spec §3.5b).

- [ ] **Step 1: Write failing route tests**

In `lots.route.test.ts`, add to the existing describe (reuse the file's seeding helpers):

```ts
it('acquireJeId discloses anchoring: real id for JE-backed lots, null for zero-basis opening (spec §3.5b)', async () => {
  // seed one receipt (derived lot), one non-zero opening, one zero-basis opening; run-rules
  // (follow this file's existing seed/run helpers — copy a nearby test's setup verbatim)
  // then:
  const body = (await getLots(app)) as LotsBody;
  const lots = body.groups.flatMap((g) => g.lots);
  const derived = lots.find((l) => l.origin === 'derived')!;
  const anchored = lots.find((l) => l.origin === 'opening' && l.costMinor !== '0')!;
  const zeroBasis = lots.find((l) => l.origin === 'opening' && l.costMinor === '0')!;
  expect(derived.acquireJeId).toMatch(/^je-/);
  expect(anchored.acquireJeId).toMatch(/^je-/);   // JE-backed opening lot is anchored
  expect(zeroBasis.acquireJeId).toBeNull();        // D2: zero basis unanchored, disclosed as such
});
```

(Adapt the local `LotsBody` interface in the test file to include `acquireJeId: string | null`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd services/api && npx vitest run test/lots.route.test.ts`
Expected: FAIL — `acquireJeId` undefined.

- [ ] **Step 3: Implement in `dto.ts`**

Add to the `LotsDTO` lot shape (after `originEventId`):

```ts
      acquireJeId: string | null; // join key into GET /entities/:id/journal — null = unanchored (legacy/zero-basis opening)
```

Main branch (the `folded.map` block, where `acquire` is already resolved and non-null):

```ts
        originEventId: acquire.eventId,
        acquireJeId: acquire.jeId,
```

Sim-only branch (where `acquire` may be undefined):

```ts
        originEventId: acquire?.eventId ?? s.originEventId,
        acquireJeId: acquire?.jeId ?? null,
```

- [ ] **Step 4: Run the api suite**

Run: `cd services/api && npx vitest run`
Expected: ALL PASS (the field is additive; nothing else should move).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/lots/dto.ts services/api/test/lots.route.test.ts
git commit -m "feat(api): lots DTO discloses anchoring via acquireJeId (spec §3.5b)"
```

---

### Task 4: Tie-out — original-basis identity, dual regime, consumed-legacy boundary

**Files:**
- Modify: `services/api/test/lots.tieout.test.ts` (header comment + tests; NO production code)

**Interfaces:**
- Consumes: Tasks 1–3 (opening JE posts to `DigitalAssets`/`OpeningBalanceEquity`; `acquireJeId`). Store helpers: `insertLotMovement` from `../src/store/lotMovementStore.js`, `markPosted` from `../src/store/eventStore.js` (verify export names before use; they are what `routes.ts` imports).
- Produces: the pinned invariant — `total − Σ(original as-loaded basis of JE-less opening lots) === GL(DigitalAssets)`.

- [ ] **Step 1: Rewrite the file header comment**

Replace the "exclusion identity" paragraph (lines 14–17) with the spec §3.5 identity: JE-backed opening lots joined the full identity; JE-less (legacy `je_id NULL` + zero-basis) are excluded at **original as-loaded basis**, because disposal credits don't discriminate by origin — with consumed `c` and remaining `r`, `total − GL = c + r = original`, so "remaining" is only right while `c = 0`.

- [ ] **Step 2: Add a legacy-seeding helper (simulates pre-change persisted data exactly)**

```ts
import { insertLotMovement } from '../src/store/lotMovementStore.js';
import { markPosted } from '../src/store/eventStore.js';

/** A pre-opening-equity-JE row: movement persisted with je_id NULL, event POSTED, no JE.
 *  Mirrors the exact shape routes.ts wrote before this feature (id/lotSeq/idempotencyKey). */
function seedLegacyOpening(db: Db, id: string, raw: RawOver): void {
  seedAuto(db, id, raw);
  const lotId = `OPEN-${id}`;
  const stamp = `${raw.eventTime as string}|${id}`;
  insertLotMovement(db, {
    id: `lm-${id}-${lotId}`, entityId: E, eventId: id, jeId: null, lotId,
    lotSeq: stamp, periodId: P, coinType: SUI, wallet: '0xacme',
    deltaQtyMinor: raw.quantityMinor as string, deltaCostMinor: raw.openingCostMinor as string,
    costBasisMethod: 'FIFO', policySetVersion: 'demo-ps-1', idempotencyKey: `${id}|${lotId}`,
  });
  markPosted(db, id);
}
```

(Verify `insertLotMovement`'s exact parameter object against `services/api/src/store/lotMovementStore.ts` — copy the field list from `routes.ts:476-488`.)

- [ ] **Step 3: Replace/extend the tests**

REPLACE the second test (`'WITH an opening lot: … opening has no GL entry'`) — its premise is now false for non-zero cost. New tests:

```ts
it('JE-backed opening lot joins the FULL identity: total === DigitalAssets GL; OBE carries the credit', async () => {
  const app = await freshApp(); const db = app._db;
  seedAuto(db, 'r1', receipt({ eventId: 'r1', txDigest: 'DIG-R1', eventTime: '2026-04-10T00:00:00Z' }));
  seedAuto(db, 'open1', opening({ eventId: 'open1', txDigest: 'DIG-OPEN1', openingCostMinor: '500000', eventTime: '2026-04-02T00:00:00Z' }));
  seedAuto(db, 'pay1', payment({ eventId: 'pay1', txDigest: 'DIG-PAY1', eventTime: '2026-04-20T00:00:00Z' }));
  expect((await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } })).statusCode).toBe(200);
  const body = await getLots(app);
  expect(body.simulationGaps).toEqual([]);
  // The opening debit is now IN DigitalAssets, so no exclusion term at all:
  expect(sumRemainingCost(body)).toBe(glBalance(db, 'DigitalAssets') + 0n); // full identity
  // …and the equity offset exists exactly once (DEBIT−CREDIT fold → negative credit balance):
  expect(glBalance(db, 'OpeningBalanceEquity')).toBe(-500000n);
});

it('legacy JE-less opening lot, CONSUMED: exclusion must use ORIGINAL basis, not remaining (spec §3.5)', async () => {
  const app = await freshApp(); const db = app._db;
  // Legacy lot is the OLDEST → FIFO consumes it first. 1e9 qty @ 500000 cost; payment takes 4e8
  // → consumed carrying c = 200000, remaining r = 300000. GL got the 200000 disposal credit but
  // never an opening debit, so: total − ORIGINAL(500000) === GL, while total − r misses by c.
  seedLegacyOpening(db, 'legacy1', opening({ eventId: 'legacy1', txDigest: 'DIG-LEG1', openingCostMinor: '500000', eventTime: '2026-04-01T00:00:00Z' }));
  seedAuto(db, 'r1', receipt({ eventId: 'r1', txDigest: 'DIG-R1', eventTime: '2026-04-10T00:00:00Z' }));
  seedAuto(db, 'pay1', payment({ eventId: 'pay1', txDigest: 'DIG-PAY1', quantityMinor: '400000000', eventTime: '2026-04-20T00:00:00Z' }));
  expect((await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } })).statusCode).toBe(200);
  const body = await getLots(app);
  expect(body.simulationGaps).toEqual([]);
  const total = sumRemainingCost(body);
  const gl = glBalance(db, 'DigitalAssets');
  const legacyRemaining = sumRemainingCost(body, (o) => o === 'opening');
  expect(legacyRemaining).toBe(300000n);              // proves FIFO really consumed the legacy lot
  expect(total - 500000n).toBe(gl);                   // ORIGINAL-basis identity holds
  expect(total - legacyRemaining).not.toBe(gl);       // "remaining" breaks by the consumed 200000
});

it('zero-basis opening lot stays excluded and harmless (D2)', async () => {
  const app = await freshApp(); const db = app._db;
  seedAuto(db, 'r1', receipt({ eventId: 'r1', txDigest: 'DIG-R1', eventTime: '2026-04-10T00:00:00Z' }));
  seedAuto(db, 'zero1', opening({ eventId: 'zero1', txDigest: 'DIG-Z1', openingCostMinor: '0', eventTime: '2026-04-02T00:00:00Z' }));
  expect((await app.inject({ method: 'POST', url: `/entities/${E}/run-rules`, payload: { periodId: P } })).statusCode).toBe(200);
  const body = await getLots(app);
  // zero basis contributes 0 to both sides — full identity unaffected, no JE, no OBE entry:
  expect(sumRemainingCost(body)).toBe(glBalance(db, 'DigitalAssets'));
  expect(glBalance(db, 'OpeningBalanceEquity')).toBe(0n);
});
```

Note on the consumed-legacy test: if `simulationGaps` is non-empty or drift appears, the manual seeding shape diverged from what the recompute replays — fix the helper to match `routes.ts` exactly; do NOT loosen assertions.

- [ ] **Step 4: Run**

Run: `cd services/api && npx vitest run test/lots.tieout.test.ts`
Expected: ALL PASS. If `expect(total - 500000n).toBe(gl)` fails with a 200000 delta, FIFO consumed the receipt lot instead — check eventTime ordering (legacy must be oldest).

- [ ] **Step 5: Full api suite + commit**

Run: `cd services/api && npx vitest run` → ALL PASS.

```bash
git add services/api/test/lots.tieout.test.ts
git commit -m "test(api): tie-out moves to original-basis identity; consumed-legacy boundary pinned (spec §3.5)"
```

---

### Task 5: Snapshot inclusion + monkey suite

**Files:**
- Test: `services/api/test/snapshot.openingLot.test.ts` (create)
- Modify: `services/api/test/monkey.lots.test.ts` (extend)

**Interfaces:**
- Consumes: `POST /entities/:id/snapshot` (routes.ts:758) — builds the merkle from persisted journal rows; previously an opening-only period threw `EMPTY_SNAPSHOT`.
- Produces: proof that the opening JE is merkle-anchored end-to-end, and the monkey coverage the repo rule requires.

- [ ] **Step 1: Write the snapshot tests (failing only if Tasks 1–2 are broken — these are integration pins, write → run → expect PASS; if they fail, the earlier task is wrong, stop and report)**

```ts
// snapshot.openingLot.test.ts — reuse lots.tieout.test.ts's helpers (copy baseEvent/opening/seedAuto/freshApp)
it('a period with only a non-zero opening lot now snapshots (JE entered the spine)', async () => {
  // seed ONE opening event (openingCostMinor '500000'), run-rules, then:
  const snap = await app.inject({ method: 'POST', url: `/entities/${E}/snapshot`, payload: { periodId: P } });
  expect(snap.statusCode).toBe(200);
  const bodySnap = snap.json() as { merkleRoot?: string; auditSnapshot?: { merkleRoot: string } };
  // assert a non-empty merkle root (adapt to the route's actual DTO shape — inspect a nearby snapshot test)
});

it('a period with only a ZERO-basis opening lot still fails loud EMPTY_SNAPSHOT (spec §3.4, D2)', async () => {
  // seed ONE opening event with openingCostMinor '0', run-rules, then:
  const snap = await app.inject({ method: 'POST', url: `/entities/${E}/snapshot`, payload: { periodId: P } });
  expect(snap.statusCode).toBeGreaterThanOrEqual(400); // EMPTY_SNAPSHOT surfaces — check exact code/shape at routes.ts:758+ and pin it
});
```

Before writing, inspect how existing snapshot tests (grep `'/snapshot'` in `services/api/test/`) assert the response and error mapping; pin the exact status/code, no `>= 400` left in the final version.

- [ ] **Step 2: Extend `monkey.lots.test.ts`** — hostile/extreme cases (repo rule: break it on purpose):

```ts
it('monkey: run-rules replay is a no-op — second run posts 0, GL/OBE unchanged', /* run-rules twice on a non-zero opening; posted===0 second time; glBalance both accounts identical */);
it('monkey: cross-event duplicate registration double-counts SYMMETRICALLY — documented non-defense (spec §6)', /* two opening events, different eventIds, same wallet/coin/cost: both post, OBE === -2×cost, full identity STILL holds — pins the honest gap so nobody mistakes idempotency for cross-event dedup */);
it('monkey: huge openingCostMinor (>2^63) survives BigInt end-to-end', /* '99999999999999999999999999' — JE balances, tie-out identity holds */);
it('monkey: negative and non-integer openingCostMinor never post', /* '-5', '1.5', '1e9' → run-rules posts 0, no JE, no movement */);
```

Write real implementations following the file's existing monkey style (grep it first); the comments above are the behavioral contracts, not placeholders to leave in.

- [ ] **Step 3: Run**

Run: `cd services/api && npx vitest run test/snapshot.openingLot.test.ts test/monkey.lots.test.ts`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add services/api/test/snapshot.openingLot.test.ts services/api/test/monkey.lots.test.ts
git commit -m "test(api): opening JE merkle inclusion + monkey coverage (replay, dup-registration non-defense, BigInt extremes)"
```

---

### Task 6: Docs + fixture governance + full-repo gate

**Files:**
- Modify: `docs/superpowers/specs/2026-07-05-c4-lot-store-design.md` (§7 + stale ref)
- Verify/adjust: `services/api/src/fixtures/acme-pilot-001.events.json` (§3.7 placement)
- Run: whole-repo verification

- [ ] **Step 1: Narrow the C4 evidence gap**

In the C4 spec's §7 deferred section: the opening-equity JE is DONE; the anchoring gap narrows to "legacy (je_id NULL) + zero-basis opening lots". While in the file, fix the stale `routes.ts:696` manifest-stub line reference (now ~786).

- [ ] **Step 2: §3.7 fixture check**

Open `acme-pilot-001.events.json`: if it contains an OPENING_LOT event, its `eventTime` must be the earliest in the fixture (inception — opening basis must not sit chronologically inside operating activity). If it violates this, move its eventTime earlier and re-run the api suite; if the fixture has no opening event, state so in the commit message — do not add one.

- [ ] **Step 3: Whole-repo gate**

```bash
npm run typecheck   # root — expect exit 0 across all workspaces
cd services/rules-engine && npx vitest run   # expect all green
cd ../api && npx vitest run                  # expect all green
cd ../../web && npx vitest run               # expect 415/415 (untouched — regression check only)
```

Report exact counts, not adjectives. `sui move test` not applicable — zero Move changes (say it, don't skip it silently).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-05-c4-lot-store-design.md services/api/src/fixtures/acme-pilot-001.events.json
git commit -m "docs(c4): evidence gap narrowed to legacy+zero-basis lots; fixture inception-placement check (§3.7)"
```

---

## Post-plan gates (after Task 6, before merge)

1. **Final whole-branch review** (most capable model, fresh context) against the spec — especially §3.5 identity math and §3.3 key knock-on.
2. **dual-review** per dev-rules — external round via fresh-context subagent (codex quota exhausted since 2026-07).
3. **Fresh-context verifier**: re-read files + re-run all suites; no self-attestation.
4. Per-task review verdicts go into `.superpowers/sdd/progress.md` (opening-equity-je section) AS THEY HAPPEN — the triage-memory ledger-gap lesson.
5. User decides merge/PR/push.
