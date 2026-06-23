# Task 2 Report

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
