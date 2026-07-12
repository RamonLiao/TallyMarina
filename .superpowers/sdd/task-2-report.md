# Task 2 Report: active loader（fail-loud 讀路徑）+ 髒資料 monkey tests

## What was implemented

Appended to `services/api/src/store/policyStore.ts` (after `ensurePolicySeed`):

- `class PolicyPersistenceError extends Error` with `code: 'POLICY_MISSING' | 'POLICY_CORRUPT'`.
- `export const CoaRulesSchema` (exported per controller resolution #3, for Task 5).
- `getActivePolicy(db, entityId)` — SELECT max version from `policy_sets`, throws `POLICY_MISSING` if no row, `POLICY_CORRUPT` on non-JSON or zod-schema-invalid doc.
- `getActiveCoaMapping(db, entityId)` — same pattern for `coa_mapping_sets`, validated against `CoaRulesSchema` (nonempty array of `{eventType, leg, account}`).
- `toResolvedPolicySet(doc, periodOpen)` — projects `PolicyDoc` down to the engine's `ResolvedPolicySet` subset; throws `POLICY_CORRUPT` if `costBasisMethod !== 'FIFO'` (engine type pins FIFO; WAC docs are storable but not yet executable).
- `buildCoaMappingFromRules(rules)` — wraps `resolveCoa` (from `policyConstants.js`) into a `CoaMapping`.

Imports added: `resolveCoa` from `../http/policyConstants.js`, `type { ResolvedPolicySet, CoaMapping }` from `../deps/rulesEngine.js`. The previously-dead `type CoaRule` import is now live (used in loader return types), per controller resolution #2.

New test file `services/api/test/policyStore.load.test.ts` — brief's test content verbatim, with controller resolution #1 applied: static ESM imports (`getActivePolicy, getActiveCoaMapping, toResolvedPolicySet, buildCoaMappingFromRules, PolicyPersistenceError, SEED_POLICY_DOC, ensurePolicySeed`) instead of inline `require(...)`; `dbWithEntity()` calls the statically-imported `ensurePolicySeed` directly.

## TDD evidence

**RED** — `cd services/api && npx vitest run test/policyStore.load.test.ts`:
```
Test Files  1 failed (1)
     Tests  5 failed | 1 passed (6)
```
(Failures: `getActivePolicy is not a function` / `toResolvedPolicySet is not a function` / `buildCoaMappingFromRules is not a function` / undefined `.code` on missing `PolicyPersistenceError` — as expected before implementation.)

**GREEN** — `cd services/api && npx vitest run test/policyStore.load.test.ts test/policyStore.test.ts`:
```
Test Files  2 passed (2)
     Tests  10 passed (10)
```

## Files changed

- `services/api/src/store/policyStore.ts` (modified — loaders appended, 2 new imports)
- `services/api/test/policyStore.load.test.ts` (new)

## Full-suite + typecheck numbers

- `cd services/api && npx vitest run`: **605/605 passed** (96 test files), up from 599/599 at Task 1 (+6 new tests from this task, no regressions, no skips).
- Root `npm run typecheck` (`npm exec --workspaces -- tsc --noEmit`): **clean, zero errors**.

## Self-review findings

- Linchpin test (`toResolvedPolicySet(SEED_POLICY_DOC, true)` vs `{...DEMO_POLICY_SET, periodOpen:true}`): verified genuine — `ResolvedPolicySet` has exactly 10 fields (`policySetVersion, assetPolicyVersion, eventPolicyVersion, ruleVersion, parserVersion, normalizationVersion, costBasisMethod, functionalCurrency, roundingThresholdMinor, periodOpen`), all 10 are explicitly assigned in `toResolvedPolicySet`'s return object from `SEED_POLICY_DOC`'s corresponding fields (which are themselves seeded verbatim from `DEMO_POLICY_SET` in Task 1). Vitest's `toEqual` performs recursive structural equality — no partial-match risk. Test passes both `periodOpen: true` and `false` branches.
- Monkey tests use real `better-sqlite3` in-memory DB via `openDb(':memory:')` and raw `db.prepare(...).run(...)` inserts of dirty JSON payloads (bad enum, missing field, non-JSON string, non-array rules object) directly into `policy_sets`/`coa_mapping_sets` — no mocks. Each confirmed to throw `PolicyPersistenceError` with the correct `.code`, proving the read path never silently falls back to constants or swallows corrupt data.
- Controller resolutions 1–3 all applied and verified: static imports work identically to the brief's `require`-based version; `CoaRule` import is now live (no unused-import warning); `CoaRulesSchema` is `export const`.

## Concerns

None. Full suite green, typecheck clean, commit created with only the two explicit paths staged (`git add services/api/src/store/policyStore.ts services/api/test/policyStore.load.test.ts`).

## Fix: WAC guard test

Added test in `services/api/test/policyStore.load.test.ts` (line 66–73, inside `describe('policy loaders (Task 2)')` block):

```ts
it('POLICY_CORRUPT: a valid-but-non-FIFO doc (WAC) is storable but not executable', () => {
  try {
    toResolvedPolicySet({ ...SEED_POLICY_DOC, costBasisMethod: 'WAC' }, true);
    expect.unreachable('should throw');
  } catch (e) {
    expect(e).toBeInstanceOf(PolicyPersistenceError);
    expect((e as PolicyPersistenceError).code).toBe('POLICY_CORRUPT');
  }
});
```

**Mutation check (red confirmed → restored green):**

1. **RED** (guard commented out):
   ```
   ❯ test/policyStore.load.test.ts > policy loaders (Task 2) > POLICY_CORRUPT: a valid-but-non-FIFO doc (WAC) is storable but not executable
     → expected AssertionError{ …(6) } to be an instance of PolicyPersistenceError
   
    Test Files  1 failed (1)
         Tests  1 failed | 6 passed (7)
   ```

2. **GREEN** (guard restored):
   ```
   ✓ test/policyStore.load.test.ts  (7 tests) 10ms
   
    Test Files  1 passed (1)
         Tests  7 passed (7)
   ```

**Both policy test files (4 + 7 = 11 tests):**
```
✓ test/policyStore.test.ts  (4 tests) 8ms
✓ test/policyStore.load.test.ts  (7 tests) 10ms

Test Files  2 passed (2)
     Tests  11 passed (11)
```

**Commit:** `716ba58` — `test(policy): red-once coverage for WAC-not-executable guard in toResolvedPolicySet`
