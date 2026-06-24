# Task 2 Report — leafEncode.ts client leaf-hash recompute (parity-pinned)

## Status: DONE

## Commit

SHA: 96c994e
Subject: feat(export): client leaf-hash recompute, parity-pinned to on-chain codec

## Test Results

Command: `cd web && npm run test -- leafEncode`

```
 ✓ src/lib/leafEncode.test.ts  (2 tests) 2ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  10:45:24
   Duration  710ms
```

`npx tsc --noEmit` — 0 errors.

## Files Created

| File | Action |
|------|--------|
| `web/src/lib/leafEncode.ts` | BCS encoder + `leafHash()` async function — byte-identical mirror of backend leafCodec |
| `web/src/lib/leafEncode.test.ts` | Parity test (merge gate) — asserts `leafHash(r.je) === r.leafHash` for every golden row |
| `web/src/lib/__fixtures__/golden-journal.json` | 2 JEs from entity `acme:pilot-001` via live API (8787) |

## Fixture Source

- Entity: `acme:pilot-001`
- Count: 2 JEs (both with reversalOf=null; legs present)
- Captured via: `curl -s http://localhost:8787/entities/acme:pilot-001/journal` with API running from `services/api/.env`

## Self-Review

- BCS field order verified against `services/rules-engine/src/core/leafCodec.ts` — identical (account, side, amountMinor, origCoinType, origQtyMinor, priceRef, fxRef, leg).
- Struct nesting: `JournalEntryLeaf { idempotencyKey, reversalOf(option), lines(vector<JeLineBcs>) }` — matches backend exactly.
- Leaf hash formula: SHA-256(0x00 || BCS bytes) — confirmed in `merkle.ts` `leafHash()`.
- `leg: String(l.leg)` cast handles `unknown` web DTO type.
- No Mascot import, DATA ZONE label present.

## Concerns

None. Two fixture rows are sufficient to pin byte-identical encoding (including all optional fields null path). No reversalOf!=null entries exist in this entity's journal yet; coverage of that path would require a reversal event.

---

# Previous Task 2 Report (period_lock table) — SUPERSEDED

## TDD Evidence

**RED:** `npx vitest run test/periodLock/store.test.ts` — FAIL (0 tests, import error: store.js not found)

**GREEN:** After schema.sql append + store.ts creation — 5/5 passed (20ms)

**tsc:** `npx tsc --noEmit` — 0 errors

## Files Changed

| File | Action |
|------|--------|
| `services/api/src/store/schema.sql` | Appended `period_lock` table (16 columns, PK on entity_id+period_id, FK to entities) |
| `services/api/src/periodLock/store.ts` | Created — exports `PeriodLockRow`, `getPeriodLock`, `lockPeriod`, `reopenPeriod` |
| `services/api/test/periodLock/store.test.ts` | Created — 5 tests: synthetic OPEN default, lock persists, lock-on-LOCKED throws, reopen bumps count, reopen-on-OPEN throws |

## Key Design Decisions

- `openDb(':memory:')` auto-applies schema.sql via `db.exec(SCHEMA)` — no extra helper needed.
- CAS: read current status inside transaction → `assertPeriodTransition` throws `ILLEGAL_TRANSITION` before any write if guard fails.
- `lockPeriod` uses `INSERT ... ON CONFLICT DO UPDATE` (upsert) to preserve `reopen_count` from pre-read row.
- `reopenPeriod` uses `UPDATE` only (row must exist since cur.status === 'LOCKED' was just verified).
- Test at `test/periodLock/store.test.ts` (not co-located), matching existing project test structure.

## Commit

SHA: f614042
Subject: feat(api): period_lock table + transactional CAS lock/reopen store

## Concerns

None — implementation is minimal, all paths tested including both ILLEGAL_TRANSITION guards.

---

# Previous Task 2 Report (exception-queue worktree) — SUPERSEDED

**Status:** DONE_WITH_CONCERNS

**Commit hash:** 1c48c50 (on worktree branch `worktree-agent-aa4a1197983e4971a`, which includes `feat/exception-queue` merged via fast-forward)

**Test summary:** `npx vitest run test/exceptions.disposition.test.ts test/exceptions.guardrail.test.ts` — 6 passed (2 test files)

---

## Rule 9 Coverage Fix — Exhaustive Transition Table

**Status:** DONE

**Test added** (`services/api/test/exceptions.disposition.test.ts`):

```typescript
it('exhaustive transition table: every legal pair passes, every illegal pair throws ILLEGAL_TRANSITION', () => {
  const states = ['open', 'resolved', 'dismissed', 'deferred'] as const;
  type S = typeof states[number];
  const legalMap: Record<S, readonly S[]> = {
    open:      ['resolved', 'dismissed', 'deferred'],
    deferred:  ['open', 'resolved', 'dismissed'],
    resolved:  [],
    dismissed: [],
  };
  for (const from of states) {
    for (const to of states) {
      const isLegal = (legalMap[from] as readonly string[]).includes(to);
      if (isLegal) {
        expect(
          () => assertDispositionTransition(from, to),
          `expected ${from}→${to} to be legal`,
        ).not.toThrow();
      } else {
        expect(
          () => assertDispositionTransition(from, to),
          `expected ${from}→${to} to throw ILLEGAL_TRANSITION`,
        ).toThrow(/ILLEGAL_TRANSITION/);
      }
    }
  }
});
```

**Command:** `npx vitest run test/exceptions.disposition.test.ts test/exceptions.guardrail.test.ts`

**Pass output:**
```
 ✓ test/exceptions.guardrail.test.ts  (1 test) 1ms
 ✓ test/exceptions.disposition.test.ts  (6 tests) 7ms

 Test Files  2 passed (2)
      Tests  7 passed (7)
```

**tsc:** Zero errors (`npx tsc --noEmit` — no output).

---

**Concerns:**

1. **Branch isolation:** The worktree could not check out `feat/exception-queue` directly (already checked out in main tree). Work was done on the worktree branch after fast-forward merging `feat/exception-queue`. The commit `1c48c50` is ahead of `d60f91b` (tip of `feat/exception-queue`). The changes need to be cherry-picked or merged back into `feat/exception-queue` in the main checkout.

2. **Guardrail comment fix:** The brief's suggested comment `// AUDIT OVERLAY ONLY. This module MUST NOT import journalStore...` contains the literal string `journalStore`, which caused the guardrail test to fail. Changed comment to avoid the literal match. This is a spec issue in the brief — the comment wording conflicts with the guardrail regex.

3. **`mkDb` test fix:** The brief's test used `{ id: 'e1', name: 'Acme', chainId: null, capId: null }` for `insertEntity`, which would fail at runtime (NOT NULL constraint on `chain_object_id`/`cap_object_id`/`original_package_id`). Corrected to match actual `EntityRow` interface.

4. **tsc:** Zero errors in `services/api`. Pre-existing errors in sibling services (`anchor-svc`, `rules-engine`, `snapshot-svc`) due to missing node_modules — not introduced by this task.

---

## Fix — reversalOf coverage + over-claim comment (post-review)

### Changes
- `web/src/lib/leafEncode.test.ts`: fixed comment that falsely claimed reversal entries were in the parity fixture (they weren't); added deterministic test proving `reversalOf` is serialized into the leaf preimage.

### Test run
```
cd web && npm run test -- leafEncode

 RUN  v1.6.1 ...
 ✓ src/lib/leafEncode.test.ts  (3 tests) 3ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```
`npx tsc --noEmit` — clean (no output).
