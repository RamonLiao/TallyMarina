# Asset Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the subledger a single, auditable authority for every asset's decimal scale, enforced at ingest, honest at read, and fail-closed at export.

**Architecture:** A new entity-scoped `asset_registry` table becomes the sole authority for `(entity, coinType) → decimals`. Decimals are fetched from on-chain `CoinMetadata` (`source='chain'`) or declared by a human (`source='manual'`). Ingest *validates* `event.assetDecimals` against the registry rather than replacing it — so journal entries, leaf encoding, merkle roots and all previously anchored snapshots stay byte-identical. Read paths return `decimals: number | null` and surface unregistered assets as a close-blocking control deficiency. Export refuses to emit a bundle containing any unknown scale.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, `@mysten/sui@2.19.0` (gRPC), Vitest, React, Vite.

**Spec:** `docs/superpowers/specs/2026-07-10-asset-registry-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

1. **Never call `client.getCoinMetadata()`.** The SDK coerces a missing `decimals` to `0` (`node_modules/@mysten/sui/dist/grpc/core.mjs:158`) behind a required-`number` type (`dist/client/types.d.mts:260`), and its bare `catch` (`core.mjs:152-153`) makes a transport error indistinguishable from "coin has no metadata". Use `client.stateService.getCoinInfo({ coinType })` and read the raw proto, where `decimals?: number` is genuinely optional (`dist/grpc/proto/sui/rpc/v2/state_service.d.mts:76-78`). Enforced by a source-scan test in Task 5.
2. **Never use `??` or `||` to supply a fallback decimals value anywhere.** The bug being fixed (`?? 9`) is exactly this reflex. Enforced by a source-scan test in Task 4.
3. **Transport errors must propagate.** A network failure reaching the Sui node is `503 CHAIN_UNREACHABLE`. It must never route a user into the manual-declaration branch.
4. **All quantity math is BigInt or pure string.** Never `Number`, `parseFloat`, or float division on a minor-unit value.
5. **CSV numeric format contract:** decimal point is `.` (U+002E); no thousands separators; leading `-` for negatives; always exactly `decimals` fractional digits (do not trim trailing zeros); `decimals=0` emits no decimal point.
6. **No dark mode.** This app has a single "paper" theme (`web/src/tokens.css` has only `:root`). Do not add `prefers-color-scheme` or `data-theme`.
7. **`--aqua` is reserved exclusively for on-chain semantics** (`web/src/workspaces/recon/recon.css` `.prov--live`). `source='chain'` uses `--aqua: #2E9FBC`. `source='manual'` uses `--brass: #B68A2E`. `manual` must never be red — it is a disclosure, not a defect.
8. **Responsive breakpoints are 640px and 1024px**, matching `recon.css`. Tables must card-ify at ≤640px.
9. **Git staging:** `git add <explicit paths>` only. Never `git add -A` or `git add .`.
10. **Every new guard must fail before it passes.** Each task's test steps include running the test against unmodified code and observing the specific failure.

**Verified paths (spec §11 had two wrong).** Recon UI lives in `web/src/workspaces/recon/`, not `reconciliation/`. `ReconciliationWorkspace.tsx` is at `web/src/workspaces/`. `lightMeta.ts` is at `web/src/workspaces/close/`.

**Commands:**
- api tests: `cd services/api && npm test`
- api single file: `cd services/api && npx vitest run test/<file>`
- api typecheck: `cd services/api && npm run typecheck`
- web tests: `cd web && npm test`
- web build: `cd web && npm run build`
- root typecheck: `npx tsc --noEmit`

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `services/api/src/assets/normalize.ts` | `canonicalCoinType()` — the only place a coinType string is made canonical or rejected |
| `services/api/src/assets/precision.ts` | `breakPrecision()` — pure string arithmetic, no I/O |
| `services/api/src/assets/store.ts` | All SQL for `asset_registry` and `asset_registry_log` |
| `services/api/src/assets/registry.ts` | `getAssetDecimals()` — synchronous lookup, safe on the ingest hot path |
| `services/api/src/assets/register.ts` | The only file with network I/O: chain fetch, register, correct |
| `services/api/scripts/seed-assets.ts` | Explicit demo seeding (not a migration) |
| `web/src/workspaces/onboarding/AssetRegistryPanel.tsx` | Registry list + add-asset form |
| `web/src/workspaces/onboarding/AssetRegistryPanel.css` | Panel styles |

**Modified**

| Path | Change |
|---|---|
| `services/api/src/store/schema.sql` | Two new tables |
| `services/api/src/store/db.ts` | Ensure new tables on existing DBs |
| `services/api/src/http/ingestEvent.ts` | Registry validation gate |
| `services/api/src/http/routes.ts` | `POST/GET/DELETE /entities/:id/assets`; `reconDTO`; `/close-readiness`; `POST /snapshot` |
| `services/api/src/reconciliation/types.ts` | Drop `decimals` from `ReconFixtureRow` |
| `services/api/src/reconciliation/fixture.ts` | Drop `decimals` validation |
| `services/api/src/reconciliation/collect.ts` | `decimals: number \| null`, `unregisteredAsset`, `precision`, new blocker fn |
| `services/api/src/lots/dto.ts` | Delete `decimalsLookup()`, read registry |
| `services/api/src/periodLock/cockpit.ts` | New `registry` light |
| `services/api/src/fixtures/acme-pilot-001.recon.json` | Delete `decimals` field |
| `web/src/api/types.ts` | DTO shape changes |
| `web/src/workspaces/recon/ReconTable.tsx` | Null-scale rendering, precision profile |
| `web/src/workspaces/recon/ReconDetail.tsx` | Suppress disposition controls on unregistered rows |
| `web/src/workspaces/ReconciliationWorkspace.tsx` | Third summary badge |
| `web/src/workspaces/close/lightMeta.ts` | `dispatchTarget('registry')` |
| `web/src/workspaces/onboarding/OnboardingWorkspace.tsx` | Mount `AssetRegistryPanel` |
| `web/src/workspaces/export/buildBundle.ts` | Decimals columns, exact strings, refusal |
| `web/src/workspaces/export/ExportWorkspace.tsx` | Unregistered-block card, source disclosure |
| `web/src/workspaces/recon/recon.css` | Precision profile + unregistered pill |

---

### Task 1: `canonicalCoinType` — the coinType chokepoint

Two coinType spellings for one asset would produce two registry rows with possibly different decimals, silently splitting an asset. `normalizeStructTag` handles hex-address forms. It does **not** resolve MVR named packages (`app@org::x::Y`) — `parseStructTag` keeps named-package addresses verbatim (`node_modules/@mysten/sui/dist/utils/sui-types.mjs:76`) while `getCoinMetadata` internally *does* resolve them (`core.mjs:148`). That asymmetry is the exact V2 threat, so named packages are rejected outright.

**Files:**
- Create: `services/api/src/assets/normalize.ts`
- Test: `services/api/test/assets.normalize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class CoinTypeError extends Error { code: 'INVALID_COIN_TYPE' | 'NAMED_PACKAGE_UNSUPPORTED'; coinType: string }`
  - `function canonicalCoinType(raw: string): string`

- [ ] **Step 1: Write the failing test**

Create `services/api/test/assets.normalize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { canonicalCoinType, CoinTypeError } from '../src/assets/normalize.js';

const SUI_LONG = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

describe('canonicalCoinType', () => {
  it('collapses the short and long address forms of one asset to one key', () => {
    // WHY: two spellings => two registry rows => one asset with two decimals.
    expect(canonicalCoinType('0x2::sui::SUI')).toBe(SUI_LONG);
    expect(canonicalCoinType(SUI_LONG)).toBe(SUI_LONG);
  });

  it('is idempotent', () => {
    expect(canonicalCoinType(canonicalCoinType('0x2::sui::SUI'))).toBe(SUI_LONG);
  });

  it('rejects MVR named packages', () => {
    // WHY: getCoinMetadata resolves the alias internally (grpc/core.mjs:148) but
    // normalizeStructTag does not (utils/sui-types.mjs:76). The fetch and the
    // registry key would disagree, producing two rows for one asset.
    expect(() => canonicalCoinType('app@org::tok::TOK')).toThrow(CoinTypeError);
    try { canonicalCoinType('app@org::tok::TOK'); } catch (e) {
      expect((e as CoinTypeError).code).toBe('NAMED_PACKAGE_UNSUPPORTED');
    }
  });

  it('rejects a SuiNS named package that isValidStructTag ACCEPTS', () => {
    // WHY: this is the guard's only load-bearing case. 'app@org::tok::TOK' is already
    // rejected by isValidStructTag, so deleting the named-package guard leaves that test
    // green. 'app.sui/tok::x::Y' passes isValidStructTag and normalizeStructTag returns it
    // verbatim — the guard is the sole defence.
    try { canonicalCoinType('app.sui/tok::x::Y'); expect.unreachable(); } catch (e) {
      expect((e as CoinTypeError).code).toBe('NAMED_PACKAGE_UNSUPPORTED');
    }
  });

  it('rejects a named package nested inside a generic type parameter', () => {
    // WHY: checking only the address before the first '::' sees the outer 0x2 and passes,
    // while mvr.resolveType resolves the INNER alias. Every address segment must be hex.
    try { canonicalCoinType('0x2::coin::Coin<app.sui/tok::x::Y>'); expect.unreachable(); } catch (e) {
      expect((e as CoinTypeError).code).toBe('NAMED_PACKAGE_UNSUPPORTED');
    }
  });

  it('accepts an uppercase 0X prefix rather than calling it a named package', () => {
    // WHY: 0X2::sui::SUI is a legal spelling. Rejecting it with NAMED_PACKAGE_UNSUPPORTED
    // is a lying error code, even though rejection itself would be safe.
    expect(canonicalCoinType('0X2::sui::SUI')).toBe(SUI_LONG);
  });

  it('rejects malformed struct tags', () => {
    for (const bad of ['', 'sui::SUI', '0x2::sui', 'not a type', '0x2::sui::SUI::extra']) {
      expect(() => canonicalCoinType(bad)).toThrow(CoinTypeError);
    }
  });

  it('rejects a non-string input at runtime', () => {
    expect(() => canonicalCoinType(undefined as unknown as string)).toThrow(CoinTypeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/assets.normalize.test.ts`
Expected: FAIL — `Cannot find module '../src/assets/normalize.js'`

- [ ] **Step 3: Write minimal implementation**

Create `services/api/src/assets/normalize.ts`:

```typescript
import { isValidStructTag, normalizeStructTag } from '@mysten/sui/utils';

export class CoinTypeError extends Error {
  constructor(
    public readonly coinType: string,
    public readonly code: 'INVALID_COIN_TYPE' | 'NAMED_PACKAGE_UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'CoinTypeError';
  }
}

// A named package address (MVR 'app@org', SuiNS 'app.sui/tok') is any address segment that is
// not hex. normalizeStructTag leaves those verbatim while getCoinMetadata resolves them via
// mvr.resolveType — so a named type and its resolved type would key two rows for one asset.
//
// EVERY address segment must be checked, not just the one before the first '::':
// '0x2::coin::Coin<app.sui/tok::x::Y>' has a hex outer address and a named inner one, and
// isValidStructTag accepts the whole thing.
const HEX_ADDRESS = /^0[xX][0-9a-fA-F]{1,64}$/;

export function canonicalCoinType(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new CoinTypeError(String(raw), 'INVALID_COIN_TYPE', `coinType must be a non-empty string`);
  }
  if (!isValidStructTag(raw)) {
    throw new CoinTypeError(raw, 'INVALID_COIN_TYPE', `not a valid coin type: ${raw}`);
  }
  assertAllAddressesHex(parseStructTag(raw), raw);
  return normalizeStructTag(raw);
}

function assertAllAddressesHex(tag: StructTag, raw: string): void {
  if (!HEX_ADDRESS.test(tag.address)) {
    throw new CoinTypeError(raw, 'NAMED_PACKAGE_UNSUPPORTED',
      `named packages are not supported; use the resolved 0x… address: ${raw}`);
  }
  for (const p of tag.typeParams) {
    if (typeof p === 'object' && p !== null && 'address' in p) assertAllAddressesHex(p as StructTag, raw);
  }
}
```

> **Implementer:** verify `parseStructTag`'s real return shape with `node -e` before writing this
> — `typeParams` may hold primitive type tags (`'u64'`) alongside struct tags, and the exact
> `StructTag` type name is in `@mysten/sui/utils`. If the shape differs, follow the real shape
> and report. `isValidStructTag` must run **before** `parseStructTag`, which throws on garbage.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/assets.normalize.test.ts`
Expected: PASS — 5 passed

- [ ] **Step 5: Mutation check**

Temporarily change `HEX_ADDRESS` to `/^.*$/` (accept anything). Re-run.
Expected: the `rejects MVR named packages` test turns RED.
Restore the original regex and re-run. Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/assets/normalize.ts services/api/test/assets.normalize.test.ts
git commit -m "feat(assets): canonicalCoinType — one asset, one registry key

normalizeStructTag collapses hex address forms but leaves MVR named packages
verbatim (utils/sui-types.mjs:76), while getCoinMetadata resolves them
internally (grpc/core.mjs:148). Reject named packages so the fetch and the
registry key can never disagree."
```

---

### Task 2: `breakPrecision` — where a difference stops being zero

Truncation, not rounding: rounding would need a half-up/half-even ruling and would *misreport* `0.0005` as reaching a place it does not occupy. `breakMinor` is already an exact minor-unit integer, so truncation is the only definition that adds no policy.

**Files:**
- Create: `services/api/src/assets/precision.ts`
- Test: `services/api/test/assets.precision.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type BreakPrecision = { exactlyZero: boolean; flatToDecimal: number | null; firstSignificantDecimal: number | null; lastSignificantDecimal: number }`
  - `function breakPrecision(breakMinor: string, decimals: number): BreakPrecision`

- [ ] **Step 1: Write the failing test**

Create `services/api/test/assets.precision.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { breakPrecision } from '../src/assets/precision.js';

describe('breakPrecision — golden values from the real acme-pilot-001 fixture', () => {
  it('SUI +1.202 reaches the integer place, so it is flat nowhere', () => {
    // WHY: a whole-unit break is never rounding dust. flatToDecimal must be null,
    // not 3 — the naive `decimals - trailingZeros` formula gives 3 and is wrong.
    expect(breakPrecision('1202000000', 9)).toEqual({
      exactlyZero: false, flatToDecimal: null, firstSignificantDecimal: null, lastSignificantDecimal: 3,
    });
  });

  it('USDC -0.5 is flat at the integer place and unflat from decimal 1', () => {
    expect(breakPrecision('-500000', 6)).toEqual({
      exactlyZero: false, flatToDecimal: 0, firstSignificantDecimal: 1, lastSignificantDecimal: 1,
    });
  });

  it('one minor unit of a 9dp coin is flat to decimal 8', () => {
    expect(breakPrecision('1', 9)).toEqual({
      exactlyZero: false, flatToDecimal: 8, firstSignificantDecimal: 9, lastSignificantDecimal: 9,
    });
  });

  it('clamps lastSignificantDecimal at 0 when trailing zeros exceed decimals', () => {
    // WHY: 10 SUI = "10000000000" has 10 trailing zeros but only 9 decimals.
    // Without the clamp this returns -1 and every consumer indexes backwards.
    expect(breakPrecision('10000000000', 9)).toEqual({
      exactlyZero: false, flatToDecimal: null, firstSignificantDecimal: null, lastSignificantDecimal: 0,
    });
  });

  it('an exactly zero break is flat everywhere', () => {
    expect(breakPrecision('0', 9)).toEqual({
      exactlyZero: true, flatToDecimal: 9, firstSignificantDecimal: null, lastSignificantDecimal: 0,
    });
  });

  it('handles decimals=0', () => {
    expect(breakPrecision('5', 0)).toEqual({
      exactlyZero: false, flatToDecimal: null, firstSignificantDecimal: null, lastSignificantDecimal: 0,
    });
  });
});

describe('breakPrecision — adversarial input (V4)', () => {
  // WHY: this codebase has already shipped a leading-zero bypass once (opening-equity I1).
  it.each([
    ['leading zeros', '007'],
    ['negative zero', '-0'],
    ['scientific notation', '1e3'],
    ['empty string', ''],
    ['whitespace', ' 1 '],
    ['decimal point', '1.5'],
    ['plus sign', '+1'],
    ['non-numeric', 'abc'],
  ])('rejects %s', (_label, bad) => {
    expect(() => breakPrecision(bad, 9)).toThrow(/invalid breakMinor/);
  });

  it('rejects an over-long string (padStart DoS)', () => {
    expect(() => breakPrecision('1'.repeat(81), 9)).toThrow(/invalid breakMinor/);
  });

  it('rejects out-of-range decimals', () => {
    expect(() => breakPrecision('1', -1)).toThrow(/invalid decimals/);
    expect(() => breakPrecision('1', 37)).toThrow(/invalid decimals/);
    expect(() => breakPrecision('1', 1.5)).toThrow(/invalid decimals/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/assets.precision.test.ts`
Expected: FAIL — `Cannot find module '../src/assets/precision.js'`

- [ ] **Step 3: Write minimal implementation**

Create `services/api/src/assets/precision.ts`:

```typescript
/**
 * Where does a reconciliation break stop being zero?
 *
 * Truncation, never rounding: breakMinor is already an exact minor-unit integer, so a
 * rounding definition would need a half-up/half-even ruling AND would misreport 0.0005
 * as occupying a place it does not. All arithmetic is on digit strings — a break on an
 * 18dp asset overflows a double long before it overflows this.
 */
export type BreakPrecision = {
  /** The break is zero. */
  exactlyZero: boolean;
  /** Truncating to this many decimal places yields zero. null = the break reaches the
   *  integer place, so it is flat at no decimal place at all. exactlyZero => decimals. */
  flatToDecimal: number | null;
  /** First nonzero decimal place, 1-based. null iff flatToDecimal is null or exactlyZero. */
  firstSignificantDecimal: number | null;
  /** Least significant decimal place, 1-based. 0 when the break is a whole-unit multiple. */
  lastSignificantDecimal: number;
};

const MINOR = /^-?(0|[1-9][0-9]*)$/;
const MAX_LEN = 80;

function trailingZeros(s: string): number {
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === '0'; i--) n++;
  return n;
}

export function breakPrecision(breakMinor: string, decimals: number): BreakPrecision {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`invalid decimals: ${decimals}`);
  }
  if (typeof breakMinor !== 'string' || breakMinor.length > MAX_LEN || !MINOR.test(breakMinor) || breakMinor === '-0') {
    throw new Error(`invalid breakMinor: ${breakMinor}`);
  }

  const s = breakMinor.startsWith('-') ? breakMinor.slice(1) : breakMinor;
  const D = decimals;

  if (s === '0') {
    return { exactlyZero: true, flatToDecimal: D, firstSignificantDecimal: null, lastSignificantDecimal: 0 };
  }

  // Clamp: "10000000000" has 10 trailing zeros against 9 decimals.
  const lastSignificantDecimal = Math.max(0, D - trailingZeros(s));
  const intPart = s.length > D ? s.slice(0, s.length - D) : '0';

  if (intPart !== '0') {
    return { exactlyZero: false, flatToDecimal: null, firstSignificantDecimal: null, lastSignificantDecimal };
  }

  const frac = s.slice(Math.max(0, s.length - D)).padStart(D, '0');
  const i = frac.search(/[1-9]/);
  return { exactlyZero: false, flatToDecimal: i, firstSignificantDecimal: i + 1, lastSignificantDecimal };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/assets.precision.test.ts`
Expected: PASS — 16 passed

- [ ] **Step 5: Mutation check**

Remove the `Math.max(0, …)` clamp (leave `D - trailingZeros(s)`). Re-run.
Expected: `clamps lastSignificantDecimal at 0` turns RED with `-1`.
Restore. Change `MINOR` to `/^-?[0-9]+$/`. Re-run.
Expected: **only** `rejects leading zeros` turns RED.
Restore. Separately delete the `|| breakMinor === '-0'` clause. Re-run.
Expected: `rejects negative zero` turns RED.
Restore all. Expected: 16 passed.

> Two mutations, not one, because `^-?(0|[1-9][0-9]*)$` **accepts** `-0` on its own — `-?`
> matches the sign and `0` matches the digit. The negative-zero rejection is a separate,
> independent guard. Weakening the regex alone leaves that test green, so a single mutation
> would have "proved" a guard that was never exercised. (Task 1, lessons 1a-2: ask what else
> besides X would reject this input.)

- [ ] **Step 6: Commit**

```bash
git add services/api/src/assets/precision.ts services/api/test/assets.precision.test.ts
git commit -m "feat(assets): breakPrecision — truncation-based scale profile

Golden values come from the real acme-pilot-001 fixture, not invented clean
numbers. SUI +1.202 pins the trap: the naive decimals-minus-trailing-zeros
formula reports 'flat to decimal 3' for a whole-unit break."
```

---

### Task 3: Schema, store, and the CHECK constraints

`asset_registry` is a brand-new table, so `CREATE TABLE IF NOT EXISTS` genuinely executes on every database — fresh and existing alike — and the CHECK constraints take effect everywhere. This is unlike the `UNIQUE(entity,period,seq)` case, where the table already existed and SQLite's inability to `ALTER TABLE … ADD CONSTRAINT` forced a `CREATE UNIQUE INDEX` workaround. **No index workaround is needed or possible here** (CHECK has no index equivalent), and none is required.

**Files:**
- Modify: `services/api/src/store/schema.sql` (append)
- Modify: `services/api/src/store/db.ts:35-43`
- Create: `services/api/src/assets/store.ts`
- Test: `services/api/test/assets.store.test.ts`

**Interfaces:**
- Consumes: `canonicalCoinType` (Task 1).
- Produces:
  - `type AssetSource = 'chain' | 'manual'`
  - `interface AssetRow { entityId: string; coinType: string; decimals: number; symbol: string; displayName: string; source: AssetSource; chainObjectId: string | null; chainObjectVersion: string | null; fetchedAt: string | null; decidedBy: string | null; reason: string | null; createdAt: string }`
  - `type LogOutcome = 'registered' | 'conflict' | 'rejected' | 'corrected'`
  - `function getAsset(db: Db, entityId: string, coinType: string): AssetRow | null`
  - `function listAssets(db: Db, entityId: string): AssetRow[]`
  - `function insertAssetIfAbsent(db: Db, row: AssetRow): 'inserted' | 'exists'`
  - `function deleteAsset(db: Db, entityId: string, coinType: string): void`
  - `function appendAssetLog(db: Db, row: { entityId: string; coinType: string; outcome: LogOutcome; decimals?: number | null; claimedDecimals?: number | null; chainDecimals?: number | null; source?: string | null; detail?: string | null; actor: string; at: string }): void`
  - `function countAssetUsage(db: Db, entityId: string, coinType: string): { events: number; jes: number; anchored: number }`

- [ ] **Step 1: Write the failing test**

Create `services/api/test/assets.store.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { getAsset, insertAssetIfAbsent, listAssets, deleteAsset, appendAssetLog, countAssetUsage, type AssetRow } from '../src/assets/store.js';

const tmpDirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assetreg-'));
  tmpDirs.push(dir);
  return join(dir, 'test.db');
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

function seedEntity(db: ReturnType<typeof openDb>): void {
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('e1','E1','0xc','0xcap','0xpkg')`).run();
}

function row(over: Partial<AssetRow> = {}): AssetRow {
  return {
    entityId: 'e1', coinType: SUI, decimals: 9, symbol: 'SUI', displayName: 'Sui',
    source: 'chain', chainObjectId: '0xmeta', chainObjectVersion: '7',
    fetchedAt: '2026-07-10T00:00:00Z', decidedBy: null, reason: null,
    createdAt: '2026-07-10T00:00:00Z', ...over,
  };
}

describe('asset_registry store', () => {
  it('inserts and reads back a row', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    expect(insertAssetIfAbsent(db, row())).toBe('inserted');
    expect(getAsset(db, 'e1', SUI)).toMatchObject({ decimals: 9, source: 'chain', symbol: 'SUI' });
    expect(listAssets(db, 'e1')).toHaveLength(1);
  });

  it('is idempotent — a second insert of the same key does not overwrite', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    insertAssetIfAbsent(db, row());
    expect(insertAssetIfAbsent(db, row({ decimals: 6 }))).toBe('exists');
    // WHY: decimals must never be silently rewritten. The caller compares and 409s.
    expect(getAsset(db, 'e1', SUI)!.decimals).toBe(9);
  });

  it('returns null for an unregistered coinType', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    expect(getAsset(db, 'e1', SUI)).toBeNull();
  });

  it('scopes rows to an entity', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
                VALUES ('e2','E2','0xc','0xcap','0xpkg')`).run();
    insertAssetIfAbsent(db, row());
    // WHY (D4): entity A's manual declaration must not leak into entity B's books.
    expect(getAsset(db, 'e2', SUI)).toBeNull();
  });

  it('deletes a row', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    insertAssetIfAbsent(db, row());
    deleteAsset(db, 'e1', SUI);
    expect(getAsset(db, 'e1', SUI)).toBeNull();
  });
});

describe('asset_registry CHECK constraints (monkey — raw SQLite, bypassing the store)', () => {
  // WHY: the last round's lesson was verbatim "the DB has no CHECK constraint on state,
  // so dirty values reach the predicate as plain strings". Do not repeat it.
  const dirty = (sql: string) => {
    const db = openDb(freshDbPath()); seedEntity(db);
    return () => db.prepare(sql).run();
  };

  it('rejects an unknown source', () => {
    expect(dirty(`INSERT INTO asset_registry (entity_id,coin_type,decimals,symbol,display_name,source,created_at)
                  VALUES ('e1','${SUI}',9,'S','S','hacked','t')`)).toThrow(/CHECK constraint/i);
  });

  it('rejects negative decimals', () => {
    expect(dirty(`INSERT INTO asset_registry (entity_id,coin_type,decimals,symbol,display_name,source,created_at)
                  VALUES ('e1','${SUI}',-1,'S','S','chain','t')`)).toThrow(/CHECK constraint/i);
  });

  it('rejects decimals above 36', () => {
    // WHY: the bound mirrors rules-engine schemas.ts:21, which bounds the 10^n exponent
    // to stop a BigInt DoS. A registry row above it would arm that DoS from the master data.
    expect(dirty(`INSERT INTO asset_registry (entity_id,coin_type,decimals,symbol,display_name,source,created_at)
                  VALUES ('e1','${SUI}',37,'S','S','chain','t')`)).toThrow(/CHECK constraint/i);
  });

  it('rejects an unknown log outcome', () => {
    expect(dirty(`INSERT INTO asset_registry_log (entity_id,coin_type,outcome,actor,at)
                  VALUES ('e1','${SUI}','whatever','a','t')`)).toThrow(/CHECK constraint/i);
  });
});

describe('appendAssetLog + countAssetUsage', () => {
  it('records a conflict with both the claimed and the chain value', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    appendAssetLog(db, { entityId: 'e1', coinType: SUI, outcome: 'conflict',
      claimedDecimals: 6, chainDecimals: 9, actor: 'demo-controller', at: 't' });
    const r = db.prepare(`SELECT claimed_decimals, chain_decimals FROM asset_registry_log`).get() as Record<string, number>;
    // WHY: an auditor re-performing "we correctly rejected the client's value" needs both
    // numbers structured, not buried in a free-text detail column.
    expect(r.claimed_decimals).toBe(6);
    expect(r.chain_decimals).toBe(9);
  });

  it('counts zero usage for a never-used coinType', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    expect(countAssetUsage(db, 'e1', SUI)).toEqual({ events: 0, jes: 0, anchored: 0 });
  });

  it('counts an event that spells the coinType in the SHORT form', () => {
    // WHY: payloads store whatever spelling the sender used, and the fixture writes
    // '0x2::sui::SUI'. A LIKE '%<long form>%' probe finds nothing here and reports the asset
    // unused — so correctAsset would delete the master data of a fully posted asset.
    // Comparison must be on canonical types, never raw substrings.
    const db = openDb(freshDbPath()); seedEntity(db);
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1',?,'POSTED')`)
      .run(JSON.stringify({ coinType: '0x2::sui::SUI', assetDecimals: 9 }));
    expect(countAssetUsage(db, 'e1', SUI).events).toBe(1);
  });

  it('counts a JE line that references the coinType under origCoinType', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    // openDb sets `foreign_keys = ON` (db.ts:14), so journal_entries.event_id must resolve.
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1','{}','POSTED')`).run();
    db.prepare(`INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash)
                VALUES ('je1','e1','ev1',?,'k1','h1')`)
      .run(JSON.stringify({ lines: [{ origCoinType: '0x2::sui::SUI' }] }));
    expect(countAssetUsage(db, 'e1', SUI).jes).toBe(1);
  });

  it('treats an unparseable payload as in-use — never as evidence of non-use', () => {
    // WHY: correction is destructive. Garbage in a row is not proof the asset is unused.
    const db = openDb(freshDbPath()); seedEntity(db);
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1','{not json','POSTED')`).run();
    expect(countAssetUsage(db, 'e1', SUI).events).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/assets.store.test.ts`
Expected: FAIL — `Cannot find module '../src/assets/store.js'`

- [ ] **Step 3a: Append to `services/api/src/store/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS asset_registry (
  entity_id            TEXT NOT NULL REFERENCES entities(id),
  coin_type            TEXT NOT NULL,
  decimals             INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  symbol               TEXT NOT NULL,
  display_name         TEXT NOT NULL,
  source               TEXT NOT NULL CHECK (source IN ('chain','manual')),
  chain_object_id      TEXT,
  chain_object_version TEXT,
  fetched_at           TEXT,
  decided_by           TEXT,
  reason               TEXT,
  created_at           TEXT NOT NULL,
  PRIMARY KEY (entity_id, coin_type)
);

CREATE TABLE IF NOT EXISTS asset_registry_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id        TEXT NOT NULL,
  coin_type        TEXT NOT NULL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('registered','conflict','rejected','corrected')),
  decimals         INTEGER,
  claimed_decimals INTEGER,
  chain_decimals   INTEGER,
  source           TEXT,
  detail           TEXT,
  actor            TEXT NOT NULL,
  at               TEXT NOT NULL
);
```

- [ ] **Step 3b: No `db.ts` change is needed — verify why, do not add one**

`openDb` runs `db.exec(SCHEMA)` on **every** open (`services/api/src/store/db.ts:15`), where `SCHEMA` is the whole of `schema.sql`. So `CREATE TABLE IF NOT EXISTS asset_registry` reaches fresh and existing databases alike, and its CHECK constraints take effect everywhere.

The `MIGRATIONS` array exists only because SQLite has no `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so column additions need the try/catch idempotency dance. A new **table** needs none of that.

Do **not** add an `ensureAssetRegistry()` helper duplicating the DDL in `db.ts`. Two copies of a schema drift.

> This also differs from `ensureSnapshotSeqUnique`: there the table already existed, and SQLite cannot `ALTER TABLE … ADD CONSTRAINT`, so a `CREATE UNIQUE INDEX` stood in for the constraint. CHECK has no index equivalent — and needs none here.

- [ ] **Step 3c: Create `services/api/src/assets/store.ts`**

```typescript
import type { Db } from '../store/db.js';
import { canonicalCoinType } from './normalize.js';

export type AssetSource = 'chain' | 'manual';
export type LogOutcome = 'registered' | 'conflict' | 'rejected' | 'corrected';

export interface AssetRow {
  entityId: string; coinType: string; decimals: number;
  symbol: string; displayName: string; source: AssetSource;
  chainObjectId: string | null; chainObjectVersion: string | null; fetchedAt: string | null;
  decidedBy: string | null; reason: string | null; createdAt: string;
}

type DbAssetRow = {
  entity_id: string; coin_type: string; decimals: number; symbol: string; display_name: string;
  source: AssetSource; chain_object_id: string | null; chain_object_version: string | null;
  fetched_at: string | null; decided_by: string | null; reason: string | null; created_at: string;
};

function mapRow(r: DbAssetRow): AssetRow {
  return {
    entityId: r.entity_id, coinType: r.coin_type, decimals: r.decimals,
    symbol: r.symbol, displayName: r.display_name, source: r.source,
    chainObjectId: r.chain_object_id, chainObjectVersion: r.chain_object_version,
    fetchedAt: r.fetched_at, decidedBy: r.decided_by, reason: r.reason, createdAt: r.created_at,
  };
}

export function getAsset(db: Db, entityId: string, coinType: string): AssetRow | null {
  const r = db.prepare(`SELECT * FROM asset_registry WHERE entity_id=? AND coin_type=?`)
    .get(entityId, coinType) as DbAssetRow | undefined;
  return r ? mapRow(r) : null;
}

export function listAssets(db: Db, entityId: string): AssetRow[] {
  const rs = db.prepare(`SELECT * FROM asset_registry WHERE entity_id=? ORDER BY symbol, coin_type`)
    .all(entityId) as DbAssetRow[];
  return rs.map(mapRow);
}

/** Never UPDATEs (D7). The caller re-reads and 409s on a decimals divergence. */
export function insertAssetIfAbsent(db: Db, row: AssetRow): 'inserted' | 'exists' {
  const res = db.prepare(
    `INSERT INTO asset_registry
       (entity_id, coin_type, decimals, symbol, display_name, source,
        chain_object_id, chain_object_version, fetched_at, decided_by, reason, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (entity_id, coin_type) DO NOTHING`,
  ).run(row.entityId, row.coinType, row.decimals, row.symbol, row.displayName, row.source,
        row.chainObjectId, row.chainObjectVersion, row.fetchedAt, row.decidedBy, row.reason, row.createdAt);
  return res.changes === 1 ? 'inserted' : 'exists';
}

export function deleteAsset(db: Db, entityId: string, coinType: string): void {
  db.prepare(`DELETE FROM asset_registry WHERE entity_id=? AND coin_type=?`).run(entityId, coinType);
}

export function appendAssetLog(db: Db, row: {
  entityId: string; coinType: string; outcome: LogOutcome;
  decimals?: number | null; claimedDecimals?: number | null; chainDecimals?: number | null;
  source?: string | null; detail?: string | null; actor: string; at: string;
}): void {
  db.prepare(
    `INSERT INTO asset_registry_log
       (entity_id, coin_type, outcome, decimals, claimed_decimals, chain_decimals, source, detail, actor, at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(row.entityId, row.coinType, row.outcome, row.decimals ?? null,
        row.claimedDecimals ?? null, row.chainDecimals ?? null, row.source ?? null,
        row.detail ?? null, row.actor, row.at);
}

/**
 * Canonical coinTypes named by a payload.
 *
 * Returns null when the payload will not parse. A caller must read null as "this row might
 * reference anything" and fail closed — an unparseable event is not evidence of non-use.
 */
function coinTypesOf(json: string): Set<string> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v !== null && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if ((k === 'coinType' || k === 'origCoinType') && typeof val === 'string') {
          try { out.add(canonicalCoinType(val)); } catch { /* not a coin type — ignore */ }
        } else {
          visit(val);
        }
      }
    }
  };
  visit(parsed);
  return out;
}

/**
 * Gate for the correction endpoint (D7b). A coinType with zero events, zero JE lines and no
 * anchored snapshot has nothing downstream to restate, so a typo may be corrected outright.
 *
 * Comparison is on CANONICAL coinTypes, never on raw substrings. Payloads store whatever
 * spelling the sender used — the fixture writes '0x2::sui::SUI' — so a `LIKE '%<long form>%'`
 * probe misses the most common spelling entirely and reports zero usage for an asset that is
 * fully posted. That failure direction deletes master data for a live asset; it must not exist.
 *
 * Slower than SQL, and correctly so: correction is a rare, destructive operation.
 *
 * The coinType PARAMETER is canonicalised too, and an uncanonicalisable one THROWS rather
 * than reading as "unused". Note this is the opposite choice from getAssetDecimals(), which
 * returns null for a malformed coinType: a read path must not explode on a legacy row, but
 * the gate on a destructive operation must not answer "safe to delete" for a string it does
 * not understand. Do not "unify" these two.
 */
export function countAssetUsage(db: Db, entityId: string, coinType: string): { events: number; jes: number; anchored: number } {
  const target = canonicalCoinType(coinType);       // throws CoinTypeError — see above
  const uses = (json: string): boolean => {
    const types = coinTypesOf(json);
    return types === null || types.has(target);     // unparseable => assume in use
  };

  const eventRows = db.prepare(`SELECT raw_json FROM events WHERE entity_id=?`).all(entityId) as { raw_json: string }[];
  const events = eventRows.filter((r) => uses(r.raw_json)).length;

  const jeRows = db.prepare(`SELECT je_json, period_id FROM journal_entries WHERE entity_id=?`)
    .all(entityId) as { je_json: string; period_id: string | null }[];
  const jes = jeRows.filter((r) => uses(r.je_json)).length;

  const anchoredPeriods = new Set(
    (db.prepare(`SELECT DISTINCT period_id FROM snapshots WHERE entity_id=? AND status='ANCHORED'`)
      .all(entityId) as { period_id: string }[]).map((r) => r.period_id),
  );
  const anchored = jeRows.filter((r) => r.period_id !== null && anchoredPeriods.has(r.period_id) && uses(r.je_json)).length;

  return { events, jes, anchored };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/assets.store.test.ts`
Expected: PASS — 14 passed

- [ ] **Step 5: Mutation check**

In `schema.sql` **and** `db.ts`, delete `CHECK (source IN ('chain','manual'))`. Re-run.
Expected: `rejects an unknown source` turns RED (the insert succeeds).
Restore both. Change `ON CONFLICT (entity_id, coin_type) DO NOTHING` to `DO UPDATE SET decimals=excluded.decimals`. Re-run.
Expected: `is idempotent` turns RED (decimals becomes 6).
Restore. Expected: 14 passed.

- [ ] **Step 6: Run the full api suite for regressions**

Run: `cd services/api && npm test`
Expected: all prior tests still pass; report the count.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/store/schema.sql services/api/src/store/db.ts services/api/src/assets/store.ts services/api/test/assets.store.test.ts
git commit -m "feat(assets): asset_registry + asset_registry_log with CHECK constraints

Deliberate deviation from the codebase convention of zero CHECK constraints.
That convention is the cause of the bug we shipped last round: 'the DB has no
CHECK constraint on state, so dirty values reach the predicate as plain
strings'. Both tables are new, so CREATE TABLE IF NOT EXISTS runs on fresh and
existing DBs alike and the constraints take effect everywhere — no index
workaround needed, unlike snapshots(seq)."
```

---

### Task 4: `getAssetDecimals` + the no-fallback source scan

The read side of the registry: synchronous, no network, safe to call from the ingest hot path and from every DTO builder.

**Files:**
- Create: `services/api/src/assets/registry.ts`
- Test: `services/api/test/assets.registry.test.ts`
- Test: `services/api/test/assets.noFallback.test.ts`

**Interfaces:**
- Consumes: `canonicalCoinType` (Task 1), `getAsset` (Task 3).
- Produces:
  - `interface AssetInfo { decimals: number; symbol: string; displayName: string; source: AssetSource }`
  - `function getAssetDecimals(db: Db, entityId: string, coinType: string): AssetInfo | null`

- [ ] **Step 1: Write the failing tests**

Create `services/api/test/assets.registry.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { insertAssetIfAbsent } from '../src/assets/store.js';
import { getAssetDecimals } from '../src/assets/registry.js';

const tmpDirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'assetreg2-')); tmpDirs.push(dir);
  const db = openDb(join(dir, 'test.db'));
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('e1','E1','0xc','0xcap','0xpkg')`).run();
  return db;
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const SUI_LONG = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

describe('getAssetDecimals', () => {
  it('returns null for an unregistered asset — never a default', () => {
    // WHY: this is the whole bug. `?? 9` silently mislabelled 6dp stablecoins by 1000x.
    expect(getAssetDecimals(freshDb(), 'e1', SUI_LONG)).toBeNull();
  });

  it('finds a row registered under the long form when queried with the short form', () => {
    const db = freshDb();
    insertAssetIfAbsent(db, { entityId: 'e1', coinType: SUI_LONG, decimals: 9, symbol: 'SUI',
      displayName: 'Sui', source: 'chain', chainObjectId: '0xm', chainObjectVersion: '1',
      fetchedAt: 't', decidedBy: null, reason: null, createdAt: 't' });
    // WHY (V2): ingest sees '0x2::sui::SUI' in the event payload; the registry stores canonical.
    expect(getAssetDecimals(db, 'e1', '0x2::sui::SUI')).toEqual({
      decimals: 9, symbol: 'SUI', displayName: 'Sui', source: 'chain',
    });
  });

  it('returns null rather than throwing for a malformed coinType', () => {
    // WHY: read paths must not explode on legacy rows. Unknown scale is a state, not a crash.
    expect(getAssetDecimals(freshDb(), 'e1', 'garbage')).toBeNull();
  });
});
```

Create `services/api/test/assets.noFallback.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m|c)?tsx?$/.test(p)) out.push(p);
  }
  return out;
}

// `decimals` as the DIRECT left operand of ?? / ||, with a substantive right operand.
//
//   caught:   decimals ?? 9      row.decimals ?? 0      fx?.decimals ?? DEFAULT
//             (decimals ?? 9)   foo(decimals ?? 9)     decimals ??\n  9
//   passed:   row.decimals ?? null          (undefined -> null SQL binding, honest)
//             decimals < 0 || decimals > 36 (range check, not a fallback)
//             !decimals || typeof decimals !== 'number'   (boolean guard)
//
// `?? null` is honest: "the value is absent, record that it is absent."
// `?? 9`    invents:   "the value is absent, so here is one." That is the bug.
// `[ \t]*` not `\s*`: JS \s matches \n, which would make a collapse-newlines pre-step an
// inert no-op whose mutation check can never go red.
// `(?<!!)` only — do NOT also exclude `(`. `(decimals ?? 9)` and `foo(decimals ?? 9)` are the
// literal reflex this guard exists to catch, merely parenthesised.
const FALLBACK_RE = /(?<!!)\bdecimals[ \t]*(\?\?|\|\|)[ \t]*(?!null\b|undefined\b|typeof\b|decimals\b)\S/i;

const SCAN_ROOTS = ['assets'].map((d) => join(__dirname, '..', 'src', d));

describe('structural guard: no decimals fallback', () => {
  // WHY: `?? 9` was not a typo. It was someone thinking "a default seems reasonable here".
  // The next person will think it too. Make the codebase say no on their behalf.
  it('contains no ?? or || fallback on a decimals expression', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        const src = readFileSync(file, 'utf8');
        // Strip comments, then collapse newlines: Prettier splits a long `decimals ??\n  9`
        // across two lines, and a per-line scan would never see the fallback.
        const code = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        code.split(';').forEach((stmt) => {
          if (FALLBACK_RE.test(stmt.replace(/\s+/g, ' '))) {
            const line = src.slice(0, src.indexOf(stmt.trim().slice(0, 40))).split('\n').length;
            offenders.push(`${file}:${line}: ${stmt.trim().slice(0, 80)}`);
          }
        });
      }
    }
    expect(offenders, `decimals must never have a fallback (spec D6/V1):\n${offenders.join('\n')}`).toEqual([]);
  });
});
```

> **Implementer:** the regex above is a starting point, not gospel. Verify it against BOTH
> lists in the comment with a throwaway probe before committing, and fix the regex — never the
> source file — if a legal line trips it. Note `SCAN_ROOTS` starts as `['assets']` here and is
> widened to include `reconciliation` and `lots` in Task 7, when the two real `?? 9` sites die.
> A tripwire aimed at a directory that never had the bug is aimed off-target.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/api && npx vitest run test/assets.registry.test.ts`
Expected: FAIL — `Cannot find module '../src/assets/registry.js'`

- [ ] **Step 3: Write the implementation**

Create `services/api/src/assets/registry.ts`:

```typescript
import type { Db } from '../store/db.js';
import { canonicalCoinType } from './normalize.js';
import { getAsset, type AssetSource } from './store.js';

export interface AssetInfo {
  decimals: number;
  symbol: string;
  displayName: string;
  source: AssetSource;
}

/**
 * The registry read. Synchronous, no network — safe on the ingest hot path.
 *
 * Returns null for an unregistered asset. It must NEVER supply a default: the entire point
 * of this table is that "we don't know this asset's scale" is a real, representable state.
 * A malformed coinType also reads as null rather than throwing, so a legacy row cannot
 * crash a read path.
 */
export function getAssetDecimals(db: Db, entityId: string, coinType: string): AssetInfo | null {
  let canonical: string;
  try { canonical = canonicalCoinType(coinType); } catch { return null; }
  const row = getAsset(db, entityId, canonical);
  if (row === null) return null;
  return { decimals: row.decimals, symbol: row.symbol, displayName: row.displayName, source: row.source };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && npx vitest run test/assets.registry.test.ts test/assets.noFallback.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Mutation check**

In `registry.ts`, change the last line to `return { decimals: row.decimals ?? 9, … }`. Re-run.
Expected: `assets.noFallback.test.ts` turns RED and names `registry.ts` with its line number.
Restore. Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/assets/registry.ts services/api/test/assets.registry.test.ts services/api/test/assets.noFallback.test.ts
git commit -m "feat(assets): getAssetDecimals + structural no-fallback guard

Returns null for unregistered assets. The source-scan test exists because ?? 9
was not a typo — it was a reasonable-seeming default. Make the codebase refuse
it on the next person's behalf."
```

---

### Task 5: `registerAsset` — chain fetch, the SDK trap, and the correction endpoint

The two SDK hazards live here and nowhere else. `getCoinMetadata` coerces a missing `decimals` to `0` and swallows transport errors; both are invisible at the call site. Everything is injected behind a `CoinInfoFetcher` so tests can drive each branch without a network.

**Files:**
- Create: `services/api/src/assets/register.ts`
- Test: `services/api/test/assets.register.test.ts`
- Test: `services/api/test/assets.noGetCoinMetadata.test.ts`

**Interfaces:**
- Consumes: `canonicalCoinType`, `CoinTypeError` (Task 1); `getAsset`, `insertAssetIfAbsent`, `deleteAsset`, `appendAssetLog`, `countAssetUsage`, `AssetRow` (Task 3).
- Produces:
  - `interface RawCoinInfo { decimals?: number; symbol?: string; name?: string; objectId?: string; version?: string }`
  - `interface CoinInfoFetcher { getCoinInfo(coinType: string): Promise<RawCoinInfo | null> }` — resolves `null` when the coin has no metadata object; **throws** `ChainUnreachableError` on any transport failure.
  - `class ChainUnreachableError extends Error`
  - `class RegisterError extends Error { status: number; code: string }`
  - `interface RegisterArgs { entityId: string; coinType: string; decimals?: number; symbol?: string; reason?: string; actor: string; now: string }`
  - `function registerAsset(db: Db, fetcher: CoinInfoFetcher, args: RegisterArgs): Promise<{ status: 200 | 201; row: AssetRow }>`
  - `function correctAsset(db: Db, entityId: string, coinType: string, actor: string, now: string): void`
  - `function makeGrpcCoinInfoFetcher(grpc: SuiGrpcClient, timeoutMs: number): CoinInfoFetcher`
  - `const MIN_REASON_LENGTH = 12`

- [ ] **Step 1: Write the failing tests**

Create `services/api/test/assets.register.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { getAsset, insertAssetIfAbsent } from '../src/assets/store.js';
import { registerAsset, correctAsset, ChainUnreachableError, RegisterError,
         type CoinInfoFetcher, type RawCoinInfo } from '../src/assets/register.js';

const tmpDirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'assetreg3-')); tmpDirs.push(dir);
  const db = openDb(join(dir, 'test.db'));
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('e1','E1','0xc','0xcap','0xpkg')`).run();
  return db;
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const SUI = '0x2::sui::SUI';
const SUI_LONG = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const NOW = '2026-07-10T00:00:00Z';
const REASON = 'private coin, no on-chain metadata published';

const fetcherOf = (fn: (c: string) => Promise<RawCoinInfo | null>): CoinInfoFetcher => ({ getCoinInfo: fn });
const chainHit: CoinInfoFetcher = fetcherOf(async () => ({ decimals: 9, symbol: 'SUI', name: 'Sui', objectId: '0xmeta', version: '7' }));
const noMetadata: CoinInfoFetcher = fetcherOf(async () => null);
const metadataWithoutDecimals: CoinInfoFetcher = fetcherOf(async () => ({ symbol: 'X', name: 'X', objectId: '0xm', version: '1' }));
const unreachable: CoinInfoFetcher = fetcherOf(async () => { throw new ChainUnreachableError('ECONNRESET'); });

describe('registerAsset — chain path', () => {
  it('registers from chain metadata under the canonical coinType', async () => {
    const db = freshDb();
    const { status, row } = await registerAsset(db, chainHit, { entityId: 'e1', coinType: SUI, actor: 'demo-controller', now: NOW });
    expect(status).toBe(201);
    expect(row.source).toBe('chain');
    expect(row.chainObjectVersion).toBe('7');
    expect(getAsset(db, 'e1', SUI_LONG)!.decimals).toBe(9);
  });

  it('is idempotent — re-registering the same decimals returns 200', async () => {
    const db = freshDb();
    await registerAsset(db, chainHit, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW });
    const { status } = await registerAsset(db, chainHit, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW });
    expect(status).toBe(200);
  });

  it('409s when the client claims a decimals the chain contradicts — chain wins', async () => {
    const db = freshDb();
    await expect(registerAsset(db, chainHit, { entityId: 'e1', coinType: SUI, decimals: 6, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'CHAIN_DECIMALS_MISMATCH', status: 409 });
    const log = db.prepare(`SELECT claimed_decimals, chain_decimals FROM asset_registry_log`).get() as Record<string, number>;
    expect(log).toEqual(expect.objectContaining({ claimed_decimals: 6, chain_decimals: 9 }));
  });

  it('409s when the asset is already registered with different decimals — never UPDATEs', async () => {
    const db = freshDb();
    insertAssetIfAbsent(db, { entityId: 'e1', coinType: SUI_LONG, decimals: 6, symbol: 'S', displayName: 'S',
      source: 'manual', chainObjectId: null, chainObjectVersion: null, fetchedAt: null,
      decidedBy: 'a', reason: REASON, createdAt: NOW });
    await expect(registerAsset(db, chainHit, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'ASSET_DECIMALS_CONFLICT', status: 409 });
    expect(getAsset(db, 'e1', SUI_LONG)!.decimals).toBe(6);
  });
});

describe('registerAsset — the SDK traps (V1, V6)', () => {
  it('a transport error is 503, NOT a manual-declaration prompt', async () => {
    // WHY (V6): the SDK's bare catch (grpc/core.mjs:152-153) returns {coinMetadata:null} for
    // BOTH "no metadata" and "network died". If a blip routed us into the manual branch, D7's
    // immutability would permanently downgrade a chain-verifiable asset to source='manual'.
    const db = freshDb();
    await expect(registerAsset(db, unreachable, { entityId: 'e1', coinType: SUI, decimals: 9, symbol: 'SUI', reason: REASON, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE', status: 503 });
    expect(getAsset(db, 'e1', SUI_LONG)).toBeNull();
  });

  it('metadata present but decimals absent must NOT become 0', async () => {
    // WHY (V1): getCoinMetadata does `decimals: response.metadata.decimals ?? 0`
    // (grpc/core.mjs:158) behind a required-number type. 0 passes every range check and is
    // indistinguishable from a legitimate 0-decimal coin. We read the raw proto instead.
    const db = freshDb();
    await expect(registerAsset(db, metadataWithoutDecimals, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'MANUAL_DECIMALS_REQUIRED', status: 400 });
    expect(getAsset(db, 'e1', SUI_LONG)).toBeNull();
  });

  it('rejects an out-of-range decimals coming back from the chain', async () => {
    const db = freshDb();
    const bad = fetcherOf(async () => ({ decimals: 99, symbol: 'X', name: 'X' }));
    await expect(registerAsset(db, bad, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'COIN_METADATA_INVALID_DECIMALS' });
  });
});

describe('registerAsset — manual path', () => {
  it('registers manually when the chain has no metadata', async () => {
    const db = freshDb();
    const { row } = await registerAsset(db, noMetadata,
      { entityId: 'e1', coinType: SUI, decimals: 6, symbol: 'FAKE', reason: REASON, actor: 'demo-controller', now: NOW });
    expect(row.source).toBe('manual');
    expect(row.decidedBy).toBe('demo-controller');
    expect(row.chainObjectId).toBeNull();
  });

  it('requires decimals, symbol and reason', async () => {
    const db = freshDb();
    for (const args of [
      { symbol: 'F', reason: REASON },
      { decimals: 6, reason: REASON },
      { decimals: 6, symbol: 'F' },
    ]) {
      await expect(registerAsset(db, noMetadata, { entityId: 'e1', coinType: SUI, actor: 'a', now: NOW, ...args }))
        .rejects.toMatchObject({ code: 'MANUAL_DECIMALS_REQUIRED' });
    }
  });

  it('rejects a placeholder reason', async () => {
    // WHY: an auditor needs a justification, not "n/a".
    const db = freshDb();
    await expect(registerAsset(db, noMetadata, { entityId: 'e1', coinType: SUI, decimals: 6, symbol: 'F', reason: 'n/a', actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'MANUAL_DECIMALS_REQUIRED' });
  });

  it('never trusts a client-supplied decidedBy', async () => {
    const db = freshDb();
    const { row } = await registerAsset(db, noMetadata,
      { entityId: 'e1', coinType: SUI, decimals: 6, symbol: 'F', reason: REASON, actor: 'server-const', now: NOW });
    expect(row.decidedBy).toBe('server-const');
  });
});

describe('registerAsset — coinType validation', () => {
  it('rejects a named package before touching the network', async () => {
    const db = freshDb();
    let called = false;
    const spy = fetcherOf(async () => { called = true; return null; });
    await expect(registerAsset(db, spy, { entityId: 'e1', coinType: 'app@org::t::T', actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'NAMED_PACKAGE_UNSUPPORTED', status: 400 });
    // WHY (V5): format validation is local and must gate the outbound RPC.
    expect(called).toBe(false);
  });

  it('rejects a malformed coinType before touching the network', async () => {
    const db = freshDb();
    let called = false;
    const spy = fetcherOf(async () => { called = true; return null; });
    await expect(registerAsset(db, spy, { entityId: 'e1', coinType: 'garbage', actor: 'a', now: NOW }))
      .rejects.toMatchObject({ code: 'INVALID_COIN_TYPE', status: 400 });
    expect(called).toBe(false);
  });
});

describe('correctAsset — zero blast radius only (D7b)', () => {
  function seedRegistered(db: ReturnType<typeof freshDb>) {
    insertAssetIfAbsent(db, { entityId: 'e1', coinType: SUI_LONG, decimals: 6, symbol: 'S', displayName: 'S',
      source: 'manual', chainObjectId: null, chainObjectVersion: null, fetchedAt: null,
      decidedBy: 'a', reason: REASON, createdAt: NOW });
  }

  it('deletes an unused registration and logs it as corrected', () => {
    const db = freshDb(); seedRegistered(db);
    correctAsset(db, 'e1', SUI, 'demo-controller', NOW);
    expect(getAsset(db, 'e1', SUI_LONG)).toBeNull();
    const log = db.prepare(`SELECT outcome FROM asset_registry_log`).get() as { outcome: string };
    expect(log.outcome).toBe('corrected');
  });

  it('refuses when an event references the coinType', () => {
    const db = freshDb(); seedRegistered(db);
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1',?,'POSTED')`)
      .run(JSON.stringify({ coinType: SUI_LONG }));
    expect(() => correctAsset(db, 'e1', SUI, 'a', NOW)).toThrow(/ASSET_IN_USE/);
    expect(getAsset(db, 'e1', SUI_LONG)).not.toBeNull();
  });

  it('refuses when a journal entry references the coinType', () => {
    const db = freshDb(); seedRegistered(db);
    db.prepare(`INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash)
                VALUES ('je1','e1','ev1',?, 'k1','h1')`).run(JSON.stringify({ lines: [{ origCoinType: SUI_LONG }] }));
    expect(() => correctAsset(db, 'e1', SUI, 'a', NOW)).toThrow(/ASSET_IN_USE/);
  });

  it('refuses when the asset is unregistered', () => {
    expect(() => correctAsset(freshDb(), 'e1', SUI, 'a', NOW)).toThrow(/ASSET_NOT_REGISTERED/);
  });
});
```

Create `services/api/test/assets.noGetCoinMetadata.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('structural guard: getCoinMetadata is banned', () => {
  it('no file under services/api/src calls getCoinMetadata', () => {
    // WHY: @mysten/sui 2.19.0 grpc/core.mjs:158 does `decimals: response.metadata.decimals ?? 0`
    // behind a required-number type, and its bare catch at :152-153 turns a transport error into
    // {coinMetadata: null}. Both are invisible at the call site. Use stateService.getCoinInfo().
    const offenders = walk(join(__dirname, '..', 'src'))
      .filter((f) => /\bgetCoinMetadata\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders, `use client.stateService.getCoinInfo() instead — see spec D14`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/api && npx vitest run test/assets.register.test.ts`
Expected: FAIL — `Cannot find module '../src/assets/register.js'`

- [ ] **Step 3: Write the implementation**

Create `services/api/src/assets/register.ts`:

```typescript
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Db } from '../store/db.js';
import { canonicalCoinType, CoinTypeError } from './normalize.js';
import { getAsset, insertAssetIfAbsent, deleteAsset, appendAssetLog, countAssetUsage, type AssetRow } from './store.js';

export const MIN_REASON_LENGTH = 12;
const PLACEHOLDER_REASON = /^(n\/?a|none|-+|\.+|tbd|todo)$/i;

/** Raw, uncoerced CoinMetadata. `decimals` is optional here exactly as the proto declares it. */
export interface RawCoinInfo {
  decimals?: number;
  symbol?: string;
  name?: string;
  objectId?: string;
  version?: string;
}

/** Resolves null when the coin has no metadata object. Throws ChainUnreachableError otherwise. */
export interface CoinInfoFetcher {
  getCoinInfo(coinType: string): Promise<RawCoinInfo | null>;
}

export class ChainUnreachableError extends Error {
  constructor(cause: string) { super(`chain unreachable: ${cause}`); this.name = 'ChainUnreachableError'; }
}

export class RegisterError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message); this.name = 'RegisterError';
  }
}

export interface RegisterArgs {
  entityId: string; coinType: string;
  decimals?: number; symbol?: string; reason?: string;
  actor: string; now: string;
}

function assertValidDecimals(d: number): void {
  if (!Number.isInteger(d) || d < 0 || d > 36) {
    throw new RegisterError(400, 'COIN_METADATA_INVALID_DECIMALS', `decimals out of range: ${d}`);
  }
}

/**
 * Adapts SuiGrpcClient to CoinInfoFetcher.
 *
 * MUST NOT use client.getCoinMetadata(): it coerces a missing decimals to 0
 * (grpc/core.mjs:158) behind a required-number type, and its bare catch (:152-153) makes a
 * transport error indistinguishable from "this coin has no metadata". Both defeat the entire
 * point of this table. stateService.getCoinInfo() exposes the truly-optional proto field and
 * lets transport errors surface.
 */
export function makeGrpcCoinInfoFetcher(grpc: SuiGrpcClient, timeoutMs: number): CoinInfoFetcher {
  return {
    async getCoinInfo(coinType: string): Promise<RawCoinInfo | null> {
      let response: { metadata?: { decimals?: number; symbol?: string; name?: string; id?: string; version?: string } };
      try {
        ({ response } = await grpc.stateService.getCoinInfo({ coinType }, { signal: AbortSignal.timeout(timeoutMs) }));
      } catch (err) {
        throw new ChainUnreachableError((err as Error).message);
      }
      if (!response.metadata) return null;
      const m = response.metadata;
      return { decimals: m.decimals, symbol: m.symbol, name: m.name, objectId: m.id, version: m.version };
    },
  };
}

export async function registerAsset(db: Db, fetcher: CoinInfoFetcher, args: RegisterArgs): Promise<{ status: 200 | 201; row: AssetRow }> {
  // Local, network-free format validation gates the outbound RPC (V5).
  let coinType: string;
  try {
    coinType = canonicalCoinType(args.coinType);
  } catch (e) {
    const err = e as CoinTypeError;
    throw new RegisterError(400, err.code, err.message);
  }

  let info: RawCoinInfo | null;
  try {
    info = await fetcher.getCoinInfo(coinType);
  } catch (e) {
    if (e instanceof ChainUnreachableError) {
      // Never fall through to the manual branch (D15/V6).
      throw new RegisterError(503, 'CHAIN_UNREACHABLE', e.message);
    }
    throw e;
  }

  let candidate: AssetRow;
  if (info !== null && info.decimals !== undefined) {
    assertValidDecimals(info.decimals);
    if (args.decimals !== undefined && args.decimals !== info.decimals) {
      appendAssetLog(db, { entityId: args.entityId, coinType, outcome: 'conflict',
        claimedDecimals: args.decimals, chainDecimals: info.decimals, actor: args.actor, at: args.now });
      throw new RegisterError(409, 'CHAIN_DECIMALS_MISMATCH',
        `on-chain metadata says ${info.decimals} decimals; chain wins`);
    }
    candidate = {
      entityId: args.entityId, coinType, decimals: info.decimals,
      symbol: info.symbol ?? coinType, displayName: info.name ?? info.symbol ?? coinType,
      source: 'chain', chainObjectId: info.objectId ?? null, chainObjectVersion: info.version ?? null,
      fetchedAt: args.now, decidedBy: null, reason: null, createdAt: args.now,
    };
  } else {
    const reasonOk = typeof args.reason === 'string'
      && args.reason.trim().length >= MIN_REASON_LENGTH
      && !PLACEHOLDER_REASON.test(args.reason.trim());
    if (args.decimals === undefined || !args.symbol || !reasonOk) {
      appendAssetLog(db, { entityId: args.entityId, coinType, outcome: 'rejected',
        detail: 'manual registration requires decimals, symbol and a substantive reason',
        actor: args.actor, at: args.now });
      throw new RegisterError(400, 'MANUAL_DECIMALS_REQUIRED',
        `no on-chain metadata; decimals, symbol and a reason (>= ${MIN_REASON_LENGTH} chars) are required`);
    }
    assertValidDecimals(args.decimals);
    candidate = {
      entityId: args.entityId, coinType, decimals: args.decimals,
      symbol: args.symbol, displayName: args.symbol,
      source: 'manual', chainObjectId: null, chainObjectVersion: null, fetchedAt: null,
      decidedBy: args.actor, reason: args.reason!.trim(), createdAt: args.now,
    };
  }

  const outcome = db.transaction(() => {
    const inserted = insertAssetIfAbsent(db, candidate);
    return { inserted, existing: getAsset(db, args.entityId, coinType)! };
  })();

  if (outcome.inserted === 'inserted') {
    appendAssetLog(db, { entityId: args.entityId, coinType, outcome: 'registered',
      decimals: candidate.decimals, source: candidate.source, actor: args.actor, at: args.now });
    return { status: 201, row: candidate };
  }

  if (outcome.existing.decimals !== candidate.decimals) {
    appendAssetLog(db, { entityId: args.entityId, coinType, outcome: 'conflict',
      claimedDecimals: candidate.decimals, chainDecimals: outcome.existing.decimals, actor: args.actor, at: args.now });
    throw new RegisterError(409, 'ASSET_DECIMALS_CONFLICT',
      `already registered at ${outcome.existing.decimals} decimals; decimals cannot change — this needs a restatement`);
  }
  return { status: 200, row: outcome.existing };
}

/**
 * D7b — the zero-blast-radius correction. A registration with nothing downstream has nothing
 * to restate; forcing restatement there would push people to register a new canonical variant
 * to route around immutability, polluting the master data the table exists to protect.
 */
export function correctAsset(db: Db, entityId: string, coinTypeRaw: string, actor: string, now: string): void {
  let coinType: string;
  try {
    coinType = canonicalCoinType(coinTypeRaw);
  } catch (e) {
    const err = e as CoinTypeError;
    throw new RegisterError(400, err.code, err.message);
  }
  if (getAsset(db, entityId, coinType) === null) {
    throw new RegisterError(404, 'ASSET_NOT_REGISTERED', `not registered: ${coinType}`);
  }
  const usage = countAssetUsage(db, entityId, coinType);
  if (usage.events > 0 || usage.jes > 0 || usage.anchored > 0) {
    throw new RegisterError(409, 'ASSET_IN_USE',
      `this asset already has entries posted (events=${usage.events}, jes=${usage.jes}, anchored=${usage.anchored}); correction requires a restatement`);
  }
  db.transaction(() => { deleteAsset(db, entityId, coinType); })();
  appendAssetLog(db, { entityId, coinType, outcome: 'corrected', actor, at: now });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && npx vitest run test/assets.register.test.ts test/assets.noGetCoinMetadata.test.ts`
Expected: PASS — 16 passed

- [ ] **Step 5: Mutation check**

In `register.ts`, change the `ChainUnreachableError` catch to `info = null` (i.e. fall through to manual). Re-run.
Expected: `a transport error is 503, NOT a manual-declaration prompt` turns RED — a `manual` row is created.
Restore. Change `info.decimals !== undefined` to `info.decimals ?? 0` semantics by writing `const d = info.decimals ?? 0`. Re-run.
Expected: `metadata present but decimals absent must NOT become 0` turns RED, **and** `assets.noFallback.test.ts` turns RED.
Restore. Expected: 16 passed.

- [ ] **Step 6: Wire the three routes**

In `services/api/src/http/routes.ts`, add imports and three handlers next to the existing onboarding routes (after line 262). Register the fetcher once from `deps`:

```typescript
import { registerAsset, correctAsset, RegisterError, makeGrpcCoinInfoFetcher } from '../assets/register.js';
import { listAssets } from '../assets/store.js';

const ASSET_ACTOR = 'demo-controller';      // server-side constant, never a client value (D13)
const COIN_INFO_TIMEOUT_MS = 5000;

// inside registerRoutes(), after the onboarding routes:
const coinInfoFetcher = makeGrpcCoinInfoFetcher(deps.grpc, COIN_INFO_TIMEOUT_MS);

app.get<{ Params: { id: string } }>('/entities/:id/assets', async (req) => {
  requireEntity(db, req.params.id);
  return { assets: listAssets(db, req.params.id) };
});

app.post<{ Params: { id: string }; Body: { coinType?: string; decimals?: number; symbol?: string; reason?: string } }>(
  '/entities/:id/assets', async (req, reply) => {
    requireEntity(db, req.params.id);
    const b = req.body ?? {};
    if (!b.coinType) throw new ApiError(400, 'VALIDATION', 'coinType is required');
    try {
      const { status, row } = await registerAsset(db, coinInfoFetcher, {
        entityId: req.params.id, coinType: b.coinType,
        decimals: b.decimals, symbol: b.symbol, reason: b.reason,
        actor: ASSET_ACTOR, now: new Date().toISOString(),
      });
      reply.code(status);
      return row;
    } catch (e) {
      if (e instanceof RegisterError) throw new ApiError(e.status, e.code, e.message);
      throw e;
    }
  });

app.delete<{ Params: { id: string; coinType: string } }>('/entities/:id/assets/:coinType', async (req) => {
  requireEntity(db, req.params.id);
  try {
    correctAsset(db, req.params.id, decodeURIComponent(req.params.coinType), ASSET_ACTOR, new Date().toISOString());
    return { corrected: true };
  } catch (e) {
    if (e instanceof RegisterError) throw new ApiError(e.status, e.code, e.message);
    throw e;
  }
});
```

Add `grpc: SuiGrpcClient;` to `RouteDeps` (`routes.ts:53-62`) and pass it from `server.ts` where `makeGrpcAdapter` already returns `{ grpc, adapter }`.

- [ ] **Step 7: Run the full api suite**

Run: `cd services/api && npm test && npm run typecheck`
Expected: all pass. Report counts.

- [ ] **Step 8: Commit**

```bash
git add services/api/src/assets/register.ts services/api/src/http/routes.ts services/api/src/server.ts services/api/test/assets.register.test.ts services/api/test/assets.noGetCoinMetadata.test.ts
git commit -m "feat(assets): registerAsset/correctAsset + POST|GET|DELETE /entities/:id/assets

Routes chain reads through stateService.getCoinInfo, never getCoinMetadata:
the SDK coerces a missing decimals to 0 (grpc/core.mjs:158) and its bare catch
(:152-153) makes a transport error look like 'coin has no metadata'. Combined
with D7 immutability, one network blip would have permanently downgraded a
chain-verifiable asset to source='manual'. Transport errors are 503 and never
route into the manual branch. correctAsset closes the other half: a
registration with zero events, zero JEs and no anchored snapshot may be fixed
outright, so a typo never forces a restatement that has nothing to restate."
```

---

### Task 6: Ingest validation — closing defect A

`event.assetDecimals` is a per-event field that feeds `mulUnitPrice()` → cost basis → JE → leaf → merkle root → chain. Two events for the same coinType may carry different scales today with nothing to stop them. The registry makes the event's claim checkable.

**Files:**
- Modify: `services/api/src/http/ingestEvent.ts`
- Test: `services/api/test/ingest.assetGate.test.ts`

**Interfaces:**
- Consumes: `getAssetDecimals` (Task 4), `appendRejectedEvent` (`services/api/src/store/rejectedEventLog.ts:3-10`).
- Produces: `class AssetGateError extends Error { reason: string }` exported from `ingestEvent.ts`.

- [ ] **Step 1: Write the failing test**

Create `services/api/test/ingest.assetGate.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { insertAssetIfAbsent } from '../src/assets/store.js';
import { ingestEvent, AssetGateError } from '../src/http/ingestEvent.js';

const tmpDirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'ingestgate-')); tmpDirs.push(dir);
  const db = openDb(join(dir, 'test.db'));
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('e1','E1','0xc','0xcap','0xpkg')`).run();
  return db;
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const SUI_LONG = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const evt = (over: Record<string, unknown> = {}) => JSON.stringify({
  eventTime: '2026-04-10T00:00:00Z', coinType: '0x2::sui::SUI', assetDecimals: 9, quantityMinor: '1000000000', ...over,
});

function register(db: ReturnType<typeof freshDb>, decimals: number) {
  insertAssetIfAbsent(db, { entityId: 'e1', coinType: SUI_LONG, decimals, symbol: 'SUI', displayName: 'Sui',
    source: 'chain', chainObjectId: '0xm', chainObjectVersion: '1', fetchedAt: 't', decidedBy: null, reason: null, createdAt: 't' });
}

function rejectReasons(db: ReturnType<typeof freshDb>): string[] {
  return (db.prepare(`SELECT reason FROM rejected_event`).all() as { reason: string }[]).map((r) => r.reason);
}

describe('ingest asset gate', () => {
  it('accepts an event whose assetDecimals matches the registry', () => {
    const db = freshDb(); register(db, 9);
    expect(() => ingestEvent(db, 'e1', evt())).not.toThrow();
  });

  it('matches across the short and long coinType forms', () => {
    const db = freshDb(); register(db, 9);
    expect(() => ingestEvent(db, 'e1', evt({ coinType: SUI_LONG }))).not.toThrow();
  });

  it('rejects an unregistered asset and logs the rejection', () => {
    const db = freshDb();
    expect(() => ingestEvent(db, 'e1', evt())).toThrow(AssetGateError);
    expect(rejectReasons(db)).toContain('ASSET_NOT_REGISTERED');
  });

  it('rejects an assetDecimals that contradicts the registry — this is defect A', () => {
    // WHY: this value feeds mulUnitPrice -> cost basis -> JE -> leaf -> merkle root -> chain.
    // Two events for one coinType with different scales would anchor an incoherent ledger.
    const db = freshDb(); register(db, 9);
    expect(() => ingestEvent(db, 'e1', evt({ assetDecimals: 6 }))).toThrow(/ASSET_DECIMALS_MISMATCH/);
    expect(rejectReasons(db)).toContain('ASSET_DECIMALS_MISMATCH');
  });

  it('rejects assetDecimals without a coinType as structurally incoherent', () => {
    const db = freshDb();
    const raw = JSON.stringify({ eventTime: '2026-04-10T00:00:00Z', assetDecimals: 9 });
    expect(() => ingestEvent(db, 'e1', raw)).toThrow(/ASSET_DECIMALS_WITHOUT_COIN_TYPE/);
  });

  it('lets a coinType-free event through untouched', () => {
    // WHY: fiat and gas events have no asset scale to check.
    const db = freshDb();
    const raw = JSON.stringify({ eventTime: '2026-04-10T00:00:00Z', amountMinor: '100' });
    expect(() => ingestEvent(db, 'e1', raw)).not.toThrow();
  });

  it('does not insert the event when the gate rejects it', () => {
    const db = freshDb();
    try { ingestEvent(db, 'e1', evt()); } catch { /* expected */ }
    expect((db.prepare(`SELECT COUNT(*) n FROM events`).get() as { n: number }).n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/ingest.assetGate.test.ts`
Expected: FAIL — `ingestEvent` accepts everything; `AssetGateError` is not exported.

- [ ] **Step 3: Modify `services/api/src/http/ingestEvent.ts`**

Add imports and the error class, then insert the gate before the existing transaction:

```typescript
import { getAssetDecimals } from '../assets/registry.js';

export class AssetGateError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(`${reason}: ${message}`);
    this.name = 'AssetGateError';
  }
}

/**
 * The registry validates, it does not replace. event.assetDecimals keeps flowing to
 * rules-engine untouched, so JE encoding, leaf hashes, merkle roots and every previously
 * anchored snapshot stay byte-identical. All this adds is a door.
 */
function assetGate(db: Db, entityId: string, parsed: Record<string, unknown>): void {
  const coinType = parsed.coinType;
  const assetDecimals = parsed.assetDecimals;

  if (typeof coinType !== 'string') {
    if (assetDecimals !== undefined) {
      throw new AssetGateError('ASSET_DECIMALS_WITHOUT_COIN_TYPE', 'assetDecimals present with no coinType');
    }
    return; // fiat / gas events carry no asset scale
  }

  const info = getAssetDecimals(db, entityId, coinType);
  if (info === null) {
    throw new AssetGateError('ASSET_NOT_REGISTERED', `${coinType} is not registered for ${entityId}`);
  }
  if (assetDecimals !== info.decimals) {
    throw new AssetGateError('ASSET_DECIMALS_MISMATCH',
      `${coinType}: event says ${String(assetDecimals)}, registry says ${info.decimals}`);
  }
}
```

Then in `ingestEvent`, replace the first three lines of the body with:

```typescript
export function ingestEvent(db: Db, entityId: string, rawJson: string): { eventId: string; periodId: string } {
  const periodId = deriveEventPeriod(rawJson); // throws INVALID_EVENT_TIME
  const parsed = JSON.parse(rawJson) as { eventTime: string } & Record<string, unknown>;
  const eventTime = parsed.eventTime;
  const eventId = `evt-${randomUUID()}`;

  // Registry gate runs before the period-lock transaction. It is a pure read, so logging the
  // rejection outside any transaction cannot be rolled back (same reasoning as the lock path).
  try {
    assetGate(db, entityId, parsed);
  } catch (err) {
    if (err instanceof AssetGateError) {
      appendRejectedEvent(db, { entityId, periodId, eventTime, rawJson, reason: err.reason });
    }
    throw err;
  }
  // ... existing period-lock transaction unchanged from here
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/ingest.assetGate.test.ts`
Expected: PASS — 7 passed

- [ ] **Step 5: Mutation check**

Comment out the `assetDecimals !== info.decimals` branch. Re-run.
Expected: `rejects an assetDecimals that contradicts the registry` turns RED.
Restore. Expected: 7 passed.

- [ ] **Step 6: Repair the existing suite**

Every existing test that ingests an event now needs a registered asset. Run:

`cd services/api && npm test`

Expect failures in tests that call `ingestEvent`/`POST /ingest` (e.g. `runRules.lots.test.ts`, `lots.route.test.ts`, `monkey.test.ts`, `snapshot.openingLot.test.ts`, `runRulesPeriodScope.test.ts`, `buildRuleInput.lots.test.ts`, `lots.tieout.test.ts`, `lots.lockpin.test.ts`, `lots.simulate.test.ts`, `monkey.lots.test.ts`).

Add a shared helper `services/api/test/helpers/registerTestAsset.ts`:

```typescript
import { insertAssetIfAbsent } from '../../src/assets/store.js';
import { canonicalCoinType } from '../../src/assets/normalize.js';
import type { Db } from '../../src/store/db.js';

/** Register an asset so ingest's registry gate lets a fixture event through. */
export function registerTestAsset(db: Db, entityId: string, coinType: string, decimals: number): void {
  insertAssetIfAbsent(db, {
    entityId, coinType: canonicalCoinType(coinType), decimals,
    symbol: coinType.split('::').pop() ?? coinType, displayName: coinType,
    source: 'chain', chainObjectId: '0xtest', chainObjectVersion: '1',
    fetchedAt: '2026-01-01T00:00:00Z', decidedBy: null, reason: null,
    createdAt: '2026-01-01T00:00:00Z',
  });
}
```

Call it in each failing test's setup, immediately after the entity is created. **Do not weaken the gate to make tests pass.** Report the exact list of files touched.

- [ ] **Step 6b: Pin the gate's callers — a rule on one door is not a rule**

`ingestEvent()` is the gate. `insertEvent()` is the raw writer it wraps. Anything else calling
`insertEvent()` walks straight past the gate, and no gate test would ever notice.

There are exactly two legitimate callers today:
- `src/http/ingestEvent.ts` — the gate itself
- `src/store/seed.ts` — **a real bypass, on the production server-start path** (`server.ts`
  calls `seed()`), fixed in Task 12

Add `services/api/test/ingest.noBypass.test.ts`: scan `src/` for `insertEvent(` and assert the
set of calling files is exactly `{ store/eventStore.ts (definition), http/ingestEvent.ts,
store/seed.ts }`. A third caller must fail the build with a message naming it.

```typescript
it('insertEvent has exactly the known callers — a new one bypasses the registry gate', () => {
  // WHY: defect A is closed by ingestEvent(). insertEvent() is the raw writer underneath it.
  // A future caller reaching for the writer instead of the gate would silently reopen the
  // path that anchors a wrong decimal scale onto the chain, and every gate test would stay green.
  const callers = walk(join(__dirname, '..', 'src'))
    .filter((f) => /\binsertEvent\s*\(/.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(f.indexOf('/src/') + 5))
    .sort();
  expect(callers).toEqual(['http/ingestEvent.ts', 'store/eventStore.ts', 'store/seed.ts']);
});
```

- [ ] **Step 7: Run the full api suite**

Run: `cd services/api && npm test && npm run typecheck`
Expected: all pass. Report counts.

- [ ] **Step 8: Commit**

```bash
git add services/api/src/http/ingestEvent.ts services/api/test/ingest.assetGate.test.ts services/api/test/helpers/registerTestAsset.ts services/api/test
git commit -m "feat(ingest): registry gate closes defect A

assetDecimals is a per-event field that feeds mulUnitPrice -> cost basis -> JE
-> leaf -> merkle root -> chain. Two events for one coinType could carry
different scales with no invariant to stop them. The registry validates the
claim; it does not replace the value, so every previously anchored root stays
byte-identical."
```

---

### Task 7: Read paths — `decimals: number | null`

Delete both `?? 9` sites and the fixture's `decimals` column. Unknown scale becomes a representable state rather than a wrong guess.

**Files:**
- Modify: `services/api/src/reconciliation/types.ts`
- Modify: `services/api/src/reconciliation/fixture.ts:26,33`
- Modify: `services/api/src/reconciliation/collect.ts:11-17,58`
- Modify: `services/api/src/lots/dto.ts:5,14,29-40,46,134`
- Modify: `services/api/src/fixtures/acme-pilot-001.recon.json`
- Test: `services/api/test/recon.unregistered.test.ts`

**Interfaces:**
- Consumes: `getAssetDecimals` (Task 4), `breakPrecision` (Task 2).
- Produces:
  - `ReconFixtureRow` loses `decimals`.
  - `ReconBreak` gains `decimals: number | null`, `unregisteredAsset: boolean`, `precision: BreakPrecision | null`, `assetSource: AssetSource | null`, `symbol: string | null`.
  - `LotsDTO['groups'][number].decimals: number | null`.

- [ ] **Step 1: Write the failing test**

Create `services/api/test/recon.unregistered.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { collectBreaks } from '../src/reconciliation/collect.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';

const tmpDirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'reconunreg-')); tmpDirs.push(dir);
  const db = openDb(join(dir, 'test.db'));
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('acme:pilot-001','ACME','0xc','0xcap','0xpkg')`).run();
  return db;
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

describe('collectBreaks with an unregistered asset', () => {
  it('surfaces the row with null decimals instead of guessing 9', () => {
    // WHY: recon.collect.test.ts:44 pins that a book-only asset must appear on screen.
    // Throwing would erase it — worse than printing it wrong. Guessing 9 is the bug.
    const db = freshDb();
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const usdc = rows.find((r) => r.coinType.includes('usdc'))!;
    expect(usdc.decimals).toBeNull();
    expect(usdc.unregisteredAsset).toBe(true);
    expect(usdc.precision).toBeNull();
  });

  it('computes decimals, source and precision once the asset is registered', () => {
    const db = freshDb();
    registerTestAsset(db, 'acme:pilot-001', '0xusdc::usdc::USDC', 6);
    const rows = collectBreaks(db, 'acme:pilot-001', '2026-Q2');
    const usdc = rows.find((r) => r.coinType.includes('usdc'))!;
    expect(usdc.decimals).toBe(6);
    expect(usdc.unregisteredAsset).toBe(false);
    expect(usdc.assetSource).toBe('chain');
    // opening 5000000000 - statement 5000500000 => break -500000 at 6dp
    expect(usdc.precision).toEqual({
      exactlyZero: false, flatToDecimal: 0, firstSignificantDecimal: 1, lastSignificantDecimal: 1,
    });
  });
});
```

> **Note for the implementer:** the USDC break value above assumes the fixture's existing
> `openingMinor`/`statementMinor`. Read `services/api/src/fixtures/acme-pilot-001.recon.json`
> and use its actual values; if the real break differs, compute the expected `BreakPrecision`
> with `breakPrecision(actualBreakMinor, 6)` by hand and pin **that**. Do not change the
> fixture's amounts to match a convenient expectation.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/recon.unregistered.test.ts`
Expected: FAIL — `usdc.decimals` is `6` (from the fixture) and `unregisteredAsset` is undefined.

- [ ] **Step 3a: `services/api/src/reconciliation/types.ts`**

Delete `decimals: number;` from `ReconFixtureRow`:

```typescript
export interface ReconFixtureRow {
  wallet: string; coinType: string;
  openingMinor: string; statementMinor: string; thresholdMinor: string;
}
```

- [ ] **Step 3b: `services/api/src/reconciliation/fixture.ts`**

At line 26 drop `decimals` from the destructure; delete the line-28 `decimals` guard; drop `decimals` from the returned object at line 33:

```typescript
    const wallet = r.wallet, coinType = r.coinType;
    if (typeof wallet !== 'string' || typeof coinType !== 'string') throw new Error(`recon fixture: wallet/coinType must be strings`);
    const key = `${wallet}|${coinType}`;
    if (seen.has(key)) throw new Error(`recon fixture: duplicate row ${key}`);
    seen.add(key);
    return {
      wallet, coinType,
      openingMinor: assertMinor(r.openingMinor, 'openingMinor', key),
      statementMinor: assertMinor(r.statementMinor, 'statementMinor', key),
      thresholdMinor: assertMinor(r.thresholdMinor, 'thresholdMinor', key),
    };
```

- [ ] **Step 3c: `services/api/src/fixtures/acme-pilot-001.recon.json`**

Remove the `"decimals": N,` key from all five rows. Leave every other value untouched.

- [ ] **Step 3d: `services/api/src/reconciliation/collect.ts`**

Add imports, widen `ReconBreak`, replace line 58:

```typescript
import { getAssetDecimals } from '../assets/registry.js';
import { breakPrecision, type BreakPrecision } from '../assets/precision.js';
import type { AssetSource } from '../assets/store.js';

export interface ReconBreak {
  wallet: string; coinType: string;
  /** null = this asset is not registered; its scale is unknown. Never a default (spec D6). */
  decimals: number | null;
  symbol: string | null;
  assetSource: AssetSource | null;
  unregisteredAsset: boolean;
  /** null when decimals is null — a scale profile without a scale is a lie. */
  precision: BreakPrecision | null;
  openingMinor: string; movementMinor: string; computedMinor: string;
  statementMinor: string; breakMinor: string; thresholdMinor: string;
  material: boolean;
  control: { debitMinor: string; creditMinor: string; legs: number };
}
```

Inside the loop, replace `decimals: fx?.decimals ?? 9,` in the `out.push({...})` with:

```typescript
    const asset = getAssetDecimals(db, entityId, coinType);
    const breakMinor = brk.toString();
    out.push({
      wallet, coinType,
      decimals: asset?.decimals ?? null,
      symbol: asset?.symbol ?? null,
      assetSource: asset?.source ?? null,
      unregisteredAsset: asset === null,
      precision: asset === null ? null : breakPrecision(breakMinor, asset.decimals),
      openingMinor: opening.toString(), movementMinor: movement.toString(), computedMinor: computed.toString(),
      statementMinor: statement.toString(), breakMinor, thresholdMinor: threshold.toString(),
      material,
      control: { debitMinor: ctl.debit.toString(), creditMinor: ctl.credit.toString(), legs: ctl.legs },
    });
```

> `asset?.decimals ?? null` and its siblings are optional-chaining on an object, not a decimals
> fallback. The Task 4 source-scan only covers `src/assets/`, so `collect.ts` is unaffected —
> but keep the pattern to `?? null` and never `?? <number>`.

- [ ] **Step 3e: `services/api/src/lots/dto.ts`**

Delete the `loadReconFixture` import (line 5), delete `decimalsLookup()` entirely (lines 29-40), delete `const decimals = decimalsLookup(entityId);` (line 46). Change the interface field to `decimals: number | null` and line 134 to:

```typescript
    groups.push({ wallet, coinType, decimals: getAssetDecimals(db, entityId, coinType)?.decimals ?? null, lots });
```

Add `import { getAssetDecimals } from '../assets/registry.js';`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/recon.unregistered.test.ts`
Expected: PASS — 2 passed

- [ ] **Step 5: Repair the existing suite**

Run: `cd services/api && npm test`

`recon.collect.test.ts`, `recon.fixture.test.ts`, `lots.route.test.ts` and `recon.openingLot.invariant.test.ts` will fail. For each:
- tests asserting `decimals === 9` from the fixture → register the asset first via `registerTestAsset`, or assert `null` where that is the honest expectation
- `recon.fixture.test.ts` cases asserting `decimals` validation → delete those cases; the field no longer exists
- `recon.openingLot.invariant.test.ts` reads both fixtures — confirm it does not read `decimals`; if it does, drop that read

**Do not change fixture amounts.** Report every file touched.

- [ ] **Step 5b: Aim the no-fallback tripwire at the sites it was built for**

`services/api/test/assets.noFallback.test.ts` (Task 4) currently scans only `src/assets/` — a
directory that has never contained a fallback. The two `?? 9` bugs it exists to prevent lived
in `collect.ts:58` and `lots/dto.ts:134`, one directory over. **The guard was green while both
bugs were alive.**

This task is where they die, so this task is where the tripwire follows them. Widen its roots:

```typescript
const SCAN_ROOTS = ['assets', 'reconciliation', 'lots'].map((d) => join(__dirname, '..', 'src', d));
```

Run it **before** deleting the `?? 9` sites. It must go RED and name `collect.ts:58`.

It will **not** name `lots/dto.ts:134`, and that is not a bug in the widened root. The guard
matches `decimals` only as the DIRECT left operand of `??`. `fx?.decimals ?? 9` has that shape;
`decimals.get(key) ?? 9` does not — the `.` after `decimals` breaks the token boundary. This is
the guard's own disclosed blind spot (indirect the token and it escapes), showing up in
production code.

Do **not** widen the regex for this, and do **not** rewrite `dto.ts` into a shape the guard can
see. Both rewrites of these lines land as `…?.decimals ?? null` — bare-token — so any future
`?? 9` regression at either site *is* caught by the regex as it stands. The blind spot exists
only in the old line that is being deleted.

Prove `lots/` is inside the scan a different way, **after** the rewrite:

- [ ] temporarily insert a bare-token `const _canary = someDecimals ?? 9;` into `lots/dto.ts`
- [ ] run the guard — it must go RED naming `lots/dto.ts` at the canary's line
- [ ] delete the canary, run again — green

That mutation proves the file is in scope. The Step-2 red proves `reconciliation/` is. Together
they cover both roots without weakening the guard or the thing it guards.

> Ordering still matters for `collect.ts`. Widening the root before Task 7 would have broken a
> green suite for two known-and-scheduled bugs. Widening it after they're gone would never prove
> the scan sees that directory.

> Ordering matters. Widening the root before Task 7 would have broken a green suite for two
> known-and-scheduled bugs. Widening it after they're gone would never prove it sees them.

- [ ] **Step 6: Run the full api suite + typecheck**

Run: `cd services/api && npm test && npm run typecheck && cd ../.. && npx tsc --noEmit`
Expected: all pass. Report counts.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/reconciliation services/api/src/lots/dto.ts services/api/src/fixtures/acme-pilot-001.recon.json services/api/test
git commit -m "feat(recon): decimals is number|null — delete both ?? 9 sites

The recon fixture no longer carries decimals; the registry is the only
authority. An unregistered asset reads as null and surfaces on screen with
unregisteredAsset:true, preserving the book-only visibility contract pinned by
recon.collect.test.ts:44. A scale profile without a scale is a lie, so
precision is null too."
```

---

### Task 8: The close gate — six call sites, one predicate

The last round's lesson, verbatim: *"the same close rule was copied five times; I grepped out three and the external reviewer found the fourth and fifth."* This time the sites are enumerated up front, and the sixth lives in the frontend.

`unregisteredAsset` is **orthogonal** to `material` and to disposition state. Do not fold it into `blocksClose()` — that predicate answers "has a human decided this break?", which is a different question from "do we know this asset's scale?".

**Files:**
- Modify: `services/api/src/reconciliation/collect.ts` (add blocker fn)
- Modify: `services/api/src/http/routes.ts` (`reconDTO`, `/close-readiness`, `POST /snapshot`)
- Modify: `services/api/src/periodLock/cockpit.ts` (new light)
- Test: `services/api/test/closeGate.unregistered.test.ts`

**Interfaces:**
- Consumes: `collectBreaks` (Task 7).
- Produces:
  - `function unregisteredAssetBlockers(db: Db, entityId: string, periodId: string): ReconBreak[]`
  - `reconDTO(...).summary` gains `unregistered: number`
  - `cockpit` lights gain `{ key: 'registry', … }`

- [ ] **Step 1: Write the failing test**

Create `services/api/test/closeGate.unregistered.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { unregisteredAssetBlockers } from '../src/reconciliation/collect.js';
import { buildCockpit } from '../src/periodLock/cockpit.js';
import { registerTestAsset } from './helpers/registerTestAsset.js';

const tmpDirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'closegate-')); tmpDirs.push(dir);
  const db = openDb(join(dir, 'test.db'));
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('acme:pilot-001','ACME','0xc','0xcap','0xpkg')`).run();
  return db;
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

// The acme:pilot-001 fixture has FOUR assets. The fixture FILE holds a second entity
// (opening-lot-recon-test:entity) whose single 0xface::tok::TOK row is not acme's.
// Counting rows across the whole file instead of per entity is how "five" got into this plan.
const ALL = [
  ['0x2::sui::SUI', 9], ['0xbeef::usdc::USDC', 6], ['0xcafe::weth::WETH', 8],
  ['0xdead::usdt::USDT', 6],
] as const;

describe('unregisteredAssetBlockers', () => {
  it('blocks close for every unregistered asset in the fixture', () => {
    const db = freshDb();
    expect(unregisteredAssetBlockers(db, 'acme:pilot-001', '2026-Q2')).toHaveLength(4);
  });

  it('clears once every asset is registered', () => {
    const db = freshDb();
    for (const [ct, dp] of ALL) registerTestAsset(db, 'acme:pilot-001', ct, dp);
    expect(unregisteredAssetBlockers(db, 'acme:pilot-001', '2026-Q2')).toHaveLength(0);
  });

  it('is orthogonal to disposition — a dismissed break with unknown scale still blocks', () => {
    // WHY (D12): "someone decided this break" and "we know this asset's scale" are different
    // questions. Folding them into one predicate lets a cosmetic dismiss clear a control gap.
    const db = freshDb();
    db.prepare(`INSERT INTO recon_break_disposition (entity_id, period_id, wallet, coin_type, state, reason_code, decided_by, decided_at)
                VALUES ('acme:pilot-001','2026-Q2','0x7a','0xusdc::usdc::USDC','dismissed','fee','a',1)`).run();
    expect(unregisteredAssetBlockers(db, 'acme:pilot-001', '2026-Q2').some((b) => b.coinType.includes('usdc'))).toBe(true);
  });
});

describe('cockpit registry light', () => {
  it('is red while any asset is unregistered and green once all are registered', () => {
    const db = freshDb();
    const red = buildCockpit(db, 'acme:pilot-001', '2026-Q2', 0.7).lights.find((l) => l.key === 'registry')!;
    expect(red.status).toBe('red');
    expect(red.real).toBe(true);
    for (const [ct, dp] of ALL) registerTestAsset(db, 'acme:pilot-001', ct, dp);
    const green = buildCockpit(db, 'acme:pilot-001', '2026-Q2', 0.7).lights.find((l) => l.key === 'registry')!;
    expect(green.status).toBe('green');
  });
});
```

> **Note for the implementer:** `buildCockpit`'s real exported name and signature are in
> `services/api/src/periodLock/cockpit.ts`. Read it and match; do not invent one.
> Likewise confirm the `recon_break_disposition` column list before writing the raw INSERT.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/closeGate.unregistered.test.ts`
Expected: FAIL — `unregisteredAssetBlockers` is not exported.

- [ ] **Step 3a: `services/api/src/reconciliation/collect.ts`**

Append, directly under `openMaterialReconBlockers`:

```typescript
/**
 * The registry half of the close gate. Deliberately NOT folded into blocksClose(): that
 * predicate answers "has a human decided this break?", which is a different question from
 * "do we know this asset's scale?". An unregistered asset blocks close no matter what anybody
 * dismissed, because a dismissal of an amount at an unknown scale decides nothing.
 *
 * Call sites (all six, enumerated so nobody has to grep):
 *   1. this function                       — the predicate
 *   2. routes.ts GET /close-readiness      — readiness must match the gate
 *   3. routes.ts POST /snapshot            — the freeze gate
 *   4. routes.ts reconDTO                  — summary.unregistered, the UI badge tally
 *   5. periodLock/cockpit.ts               — the 'registry' light
 *   6. web ReconDetail.tsx                 — suppresses disposition controls
 */
export function unregisteredAssetBlockers(db: Db, entityId: string, periodId: string): ReconBreak[] {
  return collectBreaks(db, entityId, periodId).filter((b) => b.unregisteredAsset);
}
```

- [ ] **Step 3b: `services/api/src/http/routes.ts` — `reconDTO` (line 149)**

Add to the returned summary:

```typescript
  const unregistered = rows.filter((r) => r.unregisteredAsset).length;
  return { rows, realWallet: liveWallet ?? null, summary: { material, blockingMaterial, balanced, unregistered } };
```

- [ ] **Step 3c: `services/api/src/http/routes.ts` — `GET /close-readiness` (line 533)**

```typescript
  const reconBlockers = openMaterialReconBlockers(db, req.params.id, periodId);
  const registryBlockers = unregisteredAssetBlockers(db, req.params.id, periodId);
  return {
    exceptions: { blocking: exBlockers.length, blockers: exBlockers },
    recon: { blocking: reconBlockers.length, blockers: reconBlockers.map((b) => encodeReconBreakId(b.wallet, b.coinType)) },
    registry: { blocking: registryBlockers.length, blockers: registryBlockers.map((b) => b.coinType) },
    closeable: exBlockers.length === 0 && reconBlockers.length === 0 && registryBlockers.length === 0,
  };
```

- [ ] **Step 3d: `services/api/src/http/routes.ts` — `POST /snapshot` (after the recon blocker check)**

```typescript
    const registryBlockers = unregisteredAssetBlockers(db, req.params.id, periodId);
    if (registryBlockers.length > 0) {
      throw new ApiError(409, 'UNREGISTERED_ASSETS_BLOCKING',
        `${registryBlockers.length} asset(s) have no registered decimals: ${registryBlockers.map((b) => b.coinType).join(', ')}`);
    }
```

- [ ] **Step 3e: `services/api/src/periodLock/cockpit.ts`**

Add, mirroring `classificationLight`'s shape:

```typescript
function registryLight(db: Db, entityId: string, periodId: string): Light {
  const blocking = unregisteredAssetBlockers(db, entityId, periodId).length;
  return { key: 'registry', status: blocking === 0 ? 'green' : 'red', label: 'Asset registry', real: true };
}
```

and push it into the lights array alongside the others.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/closeGate.unregistered.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 5: Mutation check (once per call site)**

Remove the `registryBlockers` check from `POST /snapshot` only. Run `npm test`.
Expected: a snapshot-gate test turns RED while the cockpit and readiness tests stay green — proving each site is pinned independently. Restore.
Repeat for `/close-readiness` and for `registryLight`. Restore all three.

> If removing a site turns **no** test red, that site has no test. Add one before proceeding.

- [ ] **Step 6: Run the full api suite + typecheck**

Run: `cd services/api && npm test && npm run typecheck`
Expected: all pass. Report counts.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/reconciliation/collect.ts services/api/src/http/routes.ts services/api/src/periodLock/cockpit.ts services/api/test/closeGate.unregistered.test.ts
git commit -m "feat(close): unregistered assets block close at every gate

Five backend call sites, enumerated in a comment rather than left to grep --
last round the same rule was copied five times and the external reviewer found
sites four and five. Deliberately not folded into blocksClose(): 'has a human
decided this break' and 'do we know this asset's scale' are different
questions, and a dismissal of an amount at an unknown scale decides nothing."
```

---

### Task 9: Recon UI — null scale and the precision profile

Two correctness-adjacent changes. `fmtMinor(minor, decimals)` cannot be called without a scale, so an unregistered row must render raw minor units. And `ReconDetail.tsx:93` renders **Dismiss** whenever `b.material` — with `unregisteredAsset` orthogonal to `material`, that is a live path to cosmetically dismissing a control gap.

**Files:**
- Modify: `web/src/api/types.ts:144-157`
- Modify: `web/src/workspaces/recon/ReconTable.tsx`
- Modify: `web/src/workspaces/recon/ReconDetail.tsx:93`
- Modify: `web/src/workspaces/ReconciliationWorkspace.tsx:52-54`
- Modify: `web/src/workspaces/close/lightMeta.ts:29-37`
- Modify: `web/src/workspaces/recon/recon.css`
- Test: `web/src/workspaces/recon/ReconTable.unregistered.test.tsx`
- Test: `web/src/workspaces/recon/ReconDetail.unregistered.test.tsx`

**Interfaces:**
- Consumes: the API DTO from Tasks 7-8.
- Produces: no new exports; `ReconRowDTO` and `ReconciliationResponse` widen.

- [ ] **Step 1: Update `web/src/api/types.ts`**

```typescript
export interface BreakPrecision {
  exactlyZero: boolean;
  flatToDecimal: number | null;
  firstSignificantDecimal: number | null;
  lastSignificantDecimal: number;
}

export interface ReconRowDTO {
  wallet: string; coinType: string;
  decimals: number | null;
  symbol: string | null;
  assetSource: 'chain' | 'manual' | null;
  unregisteredAsset: boolean;
  precision: BreakPrecision | null;
  openingMinor: string; movementMinor: string; computedMinor: string;
  statementMinor: string; breakMinor: string; thresholdMinor: string;
  material: boolean;
  control: { debitMinor: string; creditMinor: string; legs: number };
  provenance: { computed: 'book'; statement: 'mock'; chain: 'live' | 'n/a' | 'unavailable' };
  disposition: { state: string; reasonCode: string; reasonNote: string | null } | null;
}

export interface ReconciliationResponse {
  rows: ReconRowDTO[];
  realWallet: string | null;
  summary: { material: number; blockingMaterial: number; balanced: number; unregistered: number };
}
```

- [ ] **Step 2: Write the failing tests**

Create `web/src/workspaces/recon/ReconTable.unregistered.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconTable } from './ReconTable';
import type { ReconRowDTO } from '../../api/types';

const base: ReconRowDTO = {
  wallet: '0x7a', coinType: '0xusdc::usdc::USDC', decimals: null, symbol: null,
  assetSource: null, unregisteredAsset: true, precision: null,
  openingMinor: '5000000000', movementMinor: '0', computedMinor: '5000000000',
  statementMinor: '5000500000', breakMinor: '-500000', thresholdMinor: '1000000',
  material: true, control: { debitMinor: '0', creditMinor: '0', legs: 0 },
  provenance: { computed: 'book', statement: 'mock', chain: 'n/a' },
  disposition: null,
};

const registered: ReconRowDTO = {
  ...base, decimals: 6, symbol: 'USDC', assetSource: 'chain', unregisteredAsset: false,
  precision: { exactlyZero: false, flatToDecimal: 0, firstSignificantDecimal: 1, lastSignificantDecimal: 1 },
};

describe('ReconTable with an unregistered asset', () => {
  it('renders raw minor units and says the scale is unknown', () => {
    // WHY: fmtMinor(minor, decimals) cannot be called without a scale. Rendering 5000000000
    // as if it were 9dp would print 5.0 for a 5000-USDC balance.
    render(<ReconTable rows={[base]} onSelect={() => {}} selected={null} />);
    expect(screen.getByText('5000000000')).toBeInTheDocument();
    expect(screen.getAllByText(/scale unknown/i).length).toBeGreaterThan(0);
  });

  it('shows the unregistered pill and blocks-close wording', () => {
    render(<ReconTable rows={[base]} onSelect={() => {}} selected={null} />);
    expect(screen.getByText(/unregistered/i)).toBeInTheDocument();
  });

  it('formats amounts and shows the precision profile once registered', () => {
    render(<ReconTable rows={[registered]} onSelect={() => {}} selected={null} />);
    expect(screen.getByText('5000.000000')).toBeInTheDocument();
    expect(screen.getByLabelText(/integer place.*decimal 1/i)).toBeInTheDocument();
  });
});
```

Create `web/src/workspaces/recon/ReconDetail.unregistered.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReconDetail } from './ReconDetail';
import type { ReconRowDTO } from '../../api/types';

const unregisteredAndMaterial: ReconRowDTO = {
  wallet: '0x7a', coinType: '0xusdc::usdc::USDC', decimals: null, symbol: null,
  assetSource: null, unregisteredAsset: true, precision: null,
  openingMinor: '5000000000', movementMinor: '0', computedMinor: '5000000000',
  statementMinor: '5000500000', breakMinor: '-500000', thresholdMinor: '1000000',
  material: true, control: { debitMinor: '0', creditMinor: '0', legs: 0 },
  provenance: { computed: 'book', statement: 'mock', chain: 'n/a' },
  disposition: null,
};

describe('ReconDetail cannot dismiss an unregistered asset', () => {
  it('suppresses every disposition control when the scale is unknown', () => {
    // WHY (D12): ReconDetail renders Resolve/Defer/Dismiss on `b.material`. unregisteredAsset
    // is orthogonal to material, so a row can be both -- and a cosmetic dismiss would clear a
    // control gap the backend still blocks on. That is a UI-only guard failing open.
    render(<ReconDetail b={unregisteredAndMaterial} entityId="e1" periodId="2026-Q2" anchored={false} onDisposed={() => {}} />);
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /resolve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /defer/i })).toBeNull();
  });

  it('offers a route to register the asset instead', () => {
    render(<ReconDetail b={unregisteredAndMaterial} entityId="e1" periodId="2026-Q2" anchored={false} onDisposed={() => {}} />);
    expect(screen.getByText(/register asset/i)).toBeInTheDocument();
  });
});
```

> **Note for the implementer:** match `ReconTable`'s and `ReconDetail`'s real props by reading
> the components. The prop names above are illustrative; do not change the components' APIs to
> fit the test — fix the test to fit the components.

- [ ] **Step 2b: See the silent corruption before you fix it**

`fmtMinor(amountMinor, scale)` (`web/src/lib/exportCsv.ts:53-59`) does `padStart(scale + 1)` and
`digits.length - scale`. With `scale = null`, JavaScript coerces to `0`. **It does not throw.**
USDC's `5000000000` renders as `5000000000` instead of `5000.000000` — off by 10⁶, silently.

Before touching the components, write this and watch it fail:

```typescript
it('fmtMinor must not silently treat a null scale as 0', () => {
  // WHY: this is the ?? 9 bug's third form. The first wrote a default by hand. The second
  // hid one inside the SDK (`decimals ?? 0`). This one needs no `??` at all — null + 1 is 1,
  // and JS hands you a wrong scale for free. A regex guard cannot see it. Only the type can.
  expect(() => fmtMinor('5000000000', null as unknown as number)).toThrow();
});
```

Then make `fmtMinor` reject a non-integer scale, and let the call sites choose the null path
explicitly. `web/src/api/types.ts:145` currently declares `decimals: number` while `reconDTO`
already sends `null` over the wire — the type is a lie and TypeScript is believing it.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run src/workspaces/recon/ReconTable.unregistered.test.tsx src/workspaces/recon/ReconDetail.unregistered.test.tsx`
Expected: FAIL — Dismiss is present; amounts render through `fmtMinor(x, null)` as raw minor units.

- [ ] **Step 4a: `ReconTable.tsx` — null-scale cell + profile**

Add helpers near the top:

```tsx
function Amount({ minor, decimals }: { minor: string; decimals: number | null }) {
  if (decimals === null) {
    return <span className="mono amt--unscaled" title="scale unknown — asset not registered">{minor}<sup>?</sup></span>;
  }
  return <>{fmtMinor(minor, decimals)}</>;
}

function profileLabel(p: BreakPrecision): string {
  if (p.exactlyZero) return 'exactly flat';
  if (p.flatToDecimal === null) return 'whole-unit break — not rounding; unflat from the integer place';
  return `flat to decimal ${p.flatToDecimal}; unflat from decimal ${p.firstSignificantDecimal}`;
}

/** Dim the flat run, keep the significant run at full ink. Weight and ink only — never colour:
 *  the profile is information, thresholdMinor is the verdict (spec D9/§7.2). */
function BreakCell({ r }: { r: ReconRowDTO }) {
  if (r.decimals === null || r.precision === null) return <Amount minor={r.breakMinor} decimals={null} />;
  const text = fmtMinor(r.breakMinor, r.decimals);
  const dot = text.indexOf('.');
  const cut = dot < 0 || r.precision.flatToDecimal === null ? text.length : dot + 1 + r.precision.flatToDecimal;
  return (
    <span className="mono brk-profile" aria-label={profileLabel(r.precision)}>
      <span className="brk-profile__flat">{text.slice(0, cut)}</span>
      <span className="brk-profile__sig">{text.slice(cut)}</span>
    </span>
  );
}
```

Replace each `fmtMinor(r.xxxMinor, r.decimals)` call with `<Amount minor={r.xxxMinor} decimals={r.decimals} />`, and the break cell with `<BreakCell r={r} />`. Add an `[⛔ Unregistered]` pill to the first cell when `r.unregisteredAsset`, and apply `recon-row--material`'s left rail to those rows too.

- [ ] **Step 4b: `ReconDetail.tsx:93` — the sixth close gate**

```tsx
{!anchored && b.unregisteredAsset && (
  <div className="light--red recon-unregistered">
    <span className="mono">⛔ Unregistered asset</span>
    <p>This asset has no registered decimals, so its amounts have no known scale.
       It blocks close and cannot be dispositioned.</p>
    <a href="#/onboarding">Register asset →</a>
  </div>
)}
{!anchored && b.material && !b.unregisteredAsset && (
  <div className="recon-disp">
    {/* ...existing Classification select, note input, Resolve/Defer/Dismiss buttons... */}
  </div>
)}
```

- [ ] **Step 4c: `ReconciliationWorkspace.tsx:52-54` — third badge**

```tsx
{data.summary.unregistered > 0
  ? <span className="recon-summary__badge recon-summary__badge--material">⛔ {data.summary.unregistered} unregistered asset{data.summary.unregistered === 1 ? '' : 's'} — blocks close</span>
  : data.summary.blockingMaterial > 0
    ? <span className="recon-summary__badge recon-summary__badge--material">⛔ {data.summary.blockingMaterial} material break{data.summary.blockingMaterial === 1 ? '' : 's'} block close</span>
    : <span className="recon-summary__badge recon-summary__badge--ok">✓ All accounts reconciled</span>}
```

> Both blockers may be nonzero. Show the registry badge first — an unknown scale makes the
> materiality verdict itself unreliable.

- [ ] **Step 4d: `lightMeta.ts:29-37` — route the new light**

```typescript
    case 'recon':          return 'reconciliation';
    case 'registry':       return 'onboarding';
    case 'classification': return 'review';
```

> Without this case the new cockpit light falls to `default: return null` and clicking it does
> nothing.

- [ ] **Step 4e: `recon.css` — append**

```css
.amt--unscaled { color: var(--warn, #c28a1e); }
.amt--unscaled sup { color: var(--warn, #c28a1e); }
.brk-profile__flat { color: var(--ink-soft, #3e4a6b); }
.brk-profile__sig { color: var(--ink, #1a1a1a); font-weight: 700; }
.recon-pill--unregistered {
  background: var(--debit, #b5532e); color: #fff; font-weight: 700;
  padding: 1px 6px; border-radius: var(--radius-pill, 999px); margin-left: 6px;
}
.recon-unregistered { padding: 10px; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/workspaces/recon/`
Expected: PASS. Report counts.

- [ ] **Step 6: Mutation check**

In `ReconDetail.tsx`, change `b.material && !b.unregisteredAsset` back to `b.material`. Re-run.
Expected: `suppresses every disposition control` turns RED.
Restore. Expected: green.

- [ ] **Step 7: Full web suite + build + typecheck**

Run: `cd web && npm test && npm run typecheck && npm run build`
Expected: all pass. Repair any test broken by the widened DTO (they will need the new fields). Report counts.

- [ ] **Step 8: Commit**

```bash
git add web/src/api/types.ts web/src/workspaces/recon web/src/workspaces/ReconciliationWorkspace.tsx web/src/workspaces/close/lightMeta.ts
git commit -m "feat(web): null-scale rendering + precision profile + unregistered cannot be dismissed

ReconDetail rendered Resolve/Defer/Dismiss on b.material alone. unregisteredAsset
is orthogonal to material, so an unregistered asset could be cosmetically
dismissed while the backend still blocked close -- a UI-only guard failing open.
The profile uses ink weight only, never semantic colour: it is information,
thresholdMinor is the verdict."
```

---

### Task 10: `AssetRegistryPanel`

**Files:**
- Create: `web/src/workspaces/onboarding/AssetRegistryPanel.tsx`
- Create: `web/src/workspaces/onboarding/AssetRegistryPanel.css`
- Modify: `web/src/workspaces/onboarding/OnboardingWorkspace.tsx:15-21`
- Test: `web/src/workspaces/onboarding/AssetRegistryPanel.test.tsx`

**Interfaces:**
- Consumes: `GET/POST/DELETE /entities/:id/assets` (Task 5).
- Produces: `export function AssetRegistryPanel({ entityId }: { entityId: string }): JSX.Element`

**Copy map (exact strings — these are the last human-facing defence against V6):**

```typescript
const ERR: Record<string, string> = {
  INVALID_COIN_TYPE: 'Not a valid coin type. Expected 0x…::module::TYPE.',
  NAMED_PACKAGE_UNSUPPORTED: 'Named packages (app@org::…) aren’t supported. Use the resolved 0x… address.',
  MANUAL_DECIMALS_REQUIRED: 'No on-chain metadata found. Enter decimals, symbol and a reason to register manually.',
  CHAIN_DECIMALS_MISMATCH: 'On-chain metadata disagrees with your override. Chain wins — drop the override or fix it.',
  ASSET_DECIMALS_CONFLICT: 'Already registered at different decimals. Decimals can’t be changed — this needs a restatement.',
  ASSET_IN_USE: 'This asset already has entries posted. Correction requires a restatement.',
  CHAIN_UNREACHABLE: 'Couldn’t reach the Sui node. This is not the same as "no metadata" — retry before registering manually.',
};
const EMPTY = 'No assets registered yet. Every asset your books touch must be registered before close.';
```

- [ ] **Step 1: Write the failing test**

Create `web/src/workspaces/onboarding/AssetRegistryPanel.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetRegistryPanel } from './AssetRegistryPanel';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

const okList = (assets: unknown[]) => ({ ok: true, status: 200, json: async () => ({ assets }) });
const err = (status: number, code: string) => ({ ok: false, status, json: async () => ({ code, message: code }) });

describe('AssetRegistryPanel', () => {
  it('shows the empty state', async () => {
    fetchMock.mockResolvedValueOnce(okList([]));
    render(<AssetRegistryPanel entityId="e1" />);
    expect(await screen.findByText(/every asset your books touch must be registered/i)).toBeInTheDocument();
  });

  it('grades a chain-verified asset differently from a manual one', async () => {
    fetchMock.mockResolvedValueOnce(okList([
      { coinType: '0x2::sui::SUI', decimals: 9, symbol: 'SUI', source: 'chain', chainObjectId: '0xm', chainObjectVersion: '7' },
      { coinType: '0xacme::a::A', decimals: 8, symbol: 'ACME', source: 'manual', decidedBy: 'demo-controller', reason: 'private coin' },
    ]));
    render(<AssetRegistryPanel entityId="e1" />);
    expect(await screen.findByText(/chain-verified/i)).toBeInTheDocument();
    expect(screen.getByText(/manual · unverified/i)).toBeInTheDocument();
  });

  it('tells the user a node outage is NOT a reason to register manually', async () => {
    // WHY (V6): the SDK cannot distinguish a transport error from "no metadata". If an
    // operator reads 503 as "no metadata", they hand-type a scale for an asset the chain
    // could have verified — and D7 makes that permanent.
    fetchMock.mockResolvedValueOnce(okList([]));
    render(<AssetRegistryPanel entityId="e1" />);
    await screen.findByText(/every asset/i);
    fetchMock.mockResolvedValueOnce(err(503, 'CHAIN_UNREACHABLE'));
    await userEvent.type(screen.getByLabelText(/coin type/i), '0x2::sui::SUI');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    expect(await screen.findByText(/not the same as "no metadata"/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^decimals$/i)).toBeNull();
  });

  it('reveals the manual fields only when the chain has no metadata', async () => {
    fetchMock.mockResolvedValueOnce(okList([]));
    render(<AssetRegistryPanel entityId="e1" />);
    await screen.findByText(/every asset/i);
    fetchMock.mockResolvedValueOnce(err(400, 'MANUAL_DECIMALS_REQUIRED'));
    await userEvent.type(screen.getByLabelText(/coin type/i), '0xacme::a::A');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    expect(await screen.findByLabelText(/^decimals$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
  });

  it('renders the 409 conflict copy', async () => {
    fetchMock.mockResolvedValueOnce(okList([]));
    render(<AssetRegistryPanel entityId="e1" />);
    await screen.findByText(/every asset/i);
    fetchMock.mockResolvedValueOnce(err(409, 'ASSET_DECIMALS_CONFLICT'));
    await userEvent.type(screen.getByLabelText(/coin type/i), '0x2::sui::SUI');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    expect(await screen.findByText(/needs a restatement/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/workspaces/onboarding/AssetRegistryPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

Create `web/src/workspaces/onboarding/AssetRegistryPanel.tsx` with a `useState` machine over
`'idle' | 'probing' | 'chain-hit' | 'manual-required' | 'submitting' | 'error'`.

Requirements, all load-bearing:
- `probing` renders a spinner and the text `Fetching CoinMetadata on-chain…`, disables the input, and surfaces a timeout message if the request aborts.
- A `503 CHAIN_UNREACHABLE` puts the machine in `error`, **not** `manual-required`. The manual fields must not appear.
- A `400 MANUAL_DECIMALS_REQUIRED` moves to `manual-required` and reveals `decimals`, `symbol`, `reason` (all required; `reason` needs ≥ 12 characters).
- The list shows `[↗ chain-verified]` in `--aqua` for `source==='chain'` and `[✎ manual · unverified]` in `--brass` for `source==='manual'`. Equal pill weight; **manual is never red**.
- `title` on the chain pill: `CoinMetadata {chainObjectId}@{chainObjectVersion} · fetched {fetchedAt}`. On the manual pill: `declared by {decidedBy} · {reason}`.
- Error text comes from the `ERR` map above, keyed on the response `code`.

Create `AssetRegistryPanel.css`:

```css
.ar-panel { margin-top: var(--space-4); }
.ar-pill { padding: 1px 8px; border-radius: var(--radius-pill, 999px); font-weight: 600; }
.ar-pill--chain  { color: var(--aqua,  #2E9FBC); border: 1px solid var(--aqua,  #2E9FBC); }
.ar-pill--manual { color: var(--brass, #B68A2E); border: 1px solid var(--brass, #B68A2E); }
.ar-err { color: var(--debit, #B5532E); }

@media (max-width: 640px) {
  .ar-table thead { display: none; }
  .ar-table tr { display: block; border-bottom: 1px solid var(--rule, #ddd); padding: 8px 0; }
  .ar-table td { display: flex; justify-content: space-between; text-align: right; }
  .ar-table td::before { content: attr(data-label); font-weight: 600; text-align: left; }
}
```

- [ ] **Step 4: Mount it**

`web/src/workspaces/onboarding/OnboardingWorkspace.tsx`:

```tsx
    <EntitySummaryCard entity={data.entity} />
    <SourceTable data={data} onVerified={() => { void refetch(); }} />
    <AssetRegistryPanel entityId={data.entity.id} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/workspaces/onboarding/`
Expected: PASS — 5 passed

- [ ] **Step 6: Mutation check**

Make the `503` branch fall into `manual-required`. Re-run.
Expected: `tells the user a node outage is NOT a reason to register manually` turns RED.
Restore.

- [ ] **Step 7: Commit**

```bash
git add web/src/workspaces/onboarding
git commit -m "feat(web): AssetRegistryPanel — 6 states, chain vs manual grading

aqua is reserved for on-chain semantics (recon.css .prov--live), so chain
inherits it and manual takes brass. Manual is a disclosure, never red. The
503 copy is the last human-facing defence against the SDK conflating a
transport error with 'this coin has no metadata'."
```

---

### Task 11: Export — exact strings, decimals columns, fail-closed

**Files:**
- Modify: `web/src/workspaces/export/buildBundle.ts:62,67-83,99`
- Modify: `web/src/workspaces/export/ExportWorkspace.tsx`
- Create: `web/src/workspaces/export/dataDictionary.ts`
- Test: `web/src/workspaces/export/buildBundle.decimals.test.ts`

**Interfaces:**
- Consumes: `formatMinor` (`web/src/lib/exportCsv.ts:53-59`, pure string), `ReconRowDTO.decimals`.
- Produces:
  - `class UnregisteredAssetError extends Error { coinTypes: string[] }`
  - `buildBundle` throws it rather than emitting a bundle.
  - `const DATA_DICTIONARY: string` (markdown, shipped in the bundle).

- [ ] **Step 1: Write the failing test**

Create `web/src/workspaces/export/buildBundle.decimals.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildBundle, UnregisteredAssetError } from './buildBundle';

// Read buildBundle's real input type, then implement these two builders against it.
// `bundleInputWith` returns a minimal valid bundle input containing exactly one journal line
// with the given origCoinType / decimals / origQtyMinor. `journalColumn` splits journal.csv and
// returns the named column's values (excluding the header row).
declare function bundleInputWith(line: { origCoinType: string; decimals: number | null; origQtyMinor: string }): Parameters<typeof buildBundle>[0];
declare function journalColumn(csv: string, name: string): string[];

const withScale = bundleInputWith({ origCoinType: '0x2::sui::SUI', decimals: 9, origQtyMinor: '1200000000' });
const withoutScale = bundleInputWith({ origCoinType: '0xusdc::usdc::USDC', decimals: null, origQtyMinor: '5000000000' });

describe('journal.csv decimals columns', () => {
  it('emits origDecimals, an exact origQty string, and the asset source', () => {
    const out = buildBundle(withScale as never);
    const journal = out.files['journal.csv'];
    expect(journal.split('\n')[0]).toContain('origDecimals');
    expect(journal.split('\n')[0]).toContain('origQty');
    expect(journal.split('\n')[0]).toContain('origSource');
  });

  it('never trims trailing zeros and never uses a locale separator', () => {
    // WHY: an ERP importing in a comma-decimal locale silently misplaces the point.
    // That is the exact class of silent scale error this whole spec exists to kill.
    const journal = buildBundle(withScale as never).files['journal.csv'];
    expect(journal).toContain('1.200000000');
    expect(journal).not.toMatch(/1,2/);
    expect(journal).not.toContain('1.2\n');   // no trailing-zero trimming
  });

  it('emits no decimal point at all for a 0-decimal asset', () => {
    // WHY: formatMinor(x, 0) must yield "1200", not "1200." — a trailing point breaks
    // strict numeric parsers on the ERP side.
    const zeroDp = bundleInputWith({ origCoinType: '0xzero::z::Z', decimals: 0, origQtyMinor: '1200' });
    const journal = buildBundle(zeroDp).files['journal.csv'];
    const qtyCol = journalColumn(journal, 'origQty');
    expect(qtyCol).toEqual(['1200']);
    expect(journal).not.toContain('1200.');
  });
});

describe('export is fail-closed on unknown scale', () => {
  it('refuses to build a bundle containing an unregistered asset', () => {
    // WHY: a quantity without a scale entering an ERP is interpreted at *some* scale.
    // Refusing is the only honest option.
    expect(() => buildBundle(withoutScale as never)).toThrow(UnregisteredAssetError);
  });

  it('names every offending coinType so the user can go register them', () => {
    try { buildBundle(withoutScale as never); } catch (e) {
      expect((e as UnregisteredAssetError).coinTypes.length).toBeGreaterThan(0);
    }
  });
});
```

> **Note for the implementer:** `buildBundle`'s real signature and return shape are in
> `web/src/workspaces/export/buildBundle.ts`. Read it, then replace the `withScale` /
> `withoutScale` placeholders with real fixtures built from that type. Do not change
> `buildBundle`'s signature to suit the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/workspaces/export/buildBundle.decimals.test.ts`
Expected: FAIL — `UnregisteredAssetError` is not exported.

- [ ] **Step 3a: `buildBundle.ts` — fail closed, then widen the CSVs**

```typescript
export class UnregisteredAssetError extends Error {
  constructor(public readonly coinTypes: string[]) {
    super(`cannot export: ${coinTypes.length} asset(s) have no registered decimals: ${coinTypes.join(', ')}`);
    this.name = 'UnregisteredAssetError';
  }
}
```

At the top of `buildBundle`, collect every `coinType` whose `decimals` is `null` and throw before writing a single row.

New `journal.csv` header (append three columns; do not reorder the existing ones):

```typescript
const journalHeader = ['date', 'reference', 'reversalOf', 'account', 'leg', 'debit', 'credit',
  'currency', 'origCoinType', 'origDecimals', 'origQtyMinor', 'origQty', 'origSource', 'priceRef', 'fxRef'];
```

Row assembly — `origQty` uses the asset's own scale, `debit`/`credit` keep the fiat scale of 2:

```typescript
    const decimals = decimalsOf(line.origCoinType);      // number, never null: we threw above
    journalRows.push([
      date, row.je.idempotencyKey, row.je.reversalOf ?? '', line.account, String(line.leg ?? ''),
      line.side === 'DEBIT' ? formatted : '', line.side === 'CREDIT' ? formatted : '',
      functionalCurrency,
      line.origCoinType ?? '',
      line.origCoinType ? String(decimals) : '',
      line.origQtyMinor ?? '',
      line.origCoinType && line.origQtyMinor ? formatMinor(line.origQtyMinor, decimals) : '',
      line.origCoinType ? sourceOf(line.origCoinType) : '',
      line.priceRef ?? '', line.fxRef ?? '',
    ]);
```

New `quantity-recon.csv` header:

```typescript
const reconHeader = ['coinType', 'decimals', 'source',
  'acquiredMinor', 'acquired', 'disposedMinor', 'disposed', 'netMinor', 'net'];
```

> `formatMinor` (`web/src/lib/exportCsv.ts:53-59`) is already pure `padStart`/`slice` with no
> `Number` anywhere, and it always emits exactly `scale` fractional digits. It satisfies the
> §6.4.1 format contract unchanged. Do not "improve" it.

- [ ] **Step 3b: `dataDictionary.ts`**

```typescript
export const DATA_DICTIONARY = `# Data dictionary

## Numeric format
- Decimal separator is \`.\` (U+002E). No thousands separators.
- Negative values carry a leading \`-\` (U+002D).
- Quantity columns always carry exactly \`decimals\` fractional digits; trailing zeros are
  significant and are never trimmed. A 0-decimal asset emits no decimal point.
- \`*Minor\` columns are exact integers in the asset's minor units.

## journal.csv
| column | type | notes |
|---|---|---|
| origCoinType | string | canonical Sui struct tag |
| origDecimals | integer | the asset's registered scale |
| origQtyMinor | integer string | exact minor units |
| origQty | decimal string | origQtyMinor rescaled by origDecimals; lossless |
| origSource | \`chain\` \\| \`manual\` | \`manual\` = declared by a person, not verified on chain |
| debit, credit | decimal string | functional-currency amounts, always 2 decimal places |
`;
```

Include it in the bundle as `data-dictionary.md`.

- [ ] **Step 3c: `ExportWorkspace.tsx` — the block card and the disclosure card**

Catch `UnregisteredAssetError` and render a `light--red` card modelled on `DraftCard`
(`ExportWorkspace.tsx:137-150`): list the offending coinTypes and link to the registry panel.

Separately, render a **non-red** disclosure card modelled on the same shape when any exported
asset has `source==='manual'`: *"N asset(s) declared manually (未經鏈上驗證)"*, listing them.
Manual is a disclosure, not a defect — do not reuse the red treatment.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/workspaces/export/`
Expected: PASS. Report counts.

- [ ] **Step 5: Mutation check**

Delete the `UnregisteredAssetError` throw. Re-run.
Expected: `refuses to build a bundle containing an unregistered asset` turns RED.
Restore. Change `formatMinor(line.origQtyMinor, decimals)` to `String(Number(line.origQtyMinor) / 10 ** decimals)`. Re-run.
Expected: `never trims trailing zeros` turns RED (`1.2` not `1.200000000`).
Restore.

- [ ] **Step 6: Full web suite + build**

Run: `cd web && npm test && npm run typecheck && npm run build`
Expected: all pass. Report counts.

- [ ] **Step 7: Commit**

```bash
git add web/src/workspaces/export web/src/lib/exportCsv.ts
git commit -m "feat(export): decimals columns, exact quantity strings, fail-closed on unknown scale

A quantity without a scale entering an ERP is interpreted at *some* scale --
the same silent error this spec exists to kill, relocated downstream. The
bundle now refuses to build. formatMinor was already pure padStart/slice with
no Number; it satisfies the format contract unchanged."
```

---

### Task 12: Seed, live spike, and final verification

**Files:**
- Create: `services/api/scripts/seed-assets.ts`
- Create: `services/api/scripts/spike-coin-info.ts`
- Modify: `services/api/package.json` (two scripts)

- [ ] **Step 1: `seed-assets.ts`**

```typescript
/**
 * Explicit demo seeding — NOT a migration.
 *
 * The registry is master data; deriving it from existing event payloads would be exactly the
 * "infer the master file from transactions" that spec D1 rejects, smuggled in through a
 * migration. So demo assets are declared here, in a file a reviewer can read.
 *
 * Only 0x2::sui::SUI exists on chain. The other four are placeholder coin types and are
 * registered as source='manual' — which is what export and the manifest will disclose.
 */
import { openDb } from '../src/store/db.js';
import { registerAsset, makeGrpcCoinInfoFetcher, type CoinInfoFetcher } from '../src/assets/register.js';
import { makeGrpcClient } from '../src/grpcClient.js';
import { loadConfig } from '../src/config.js';

const ENTITY = process.env.ENTITY_ID ?? 'acme:pilot-001';
// Hex placeholders, not the original 0xusdc/0xweth/... — those are not valid Sui struct tags
// (u, s, w, t, o, p, n are not hex digits) and canonicalCoinType rejects them outright.
// See spec §4.2.1. They are valid types that do not exist on chain, which is exactly what
// source='manual' is for.
// acme:pilot-001 holds exactly these four. 0xface::tok::TOK belongs to the OTHER entity in
// the fixture file (opening-lot-recon-test:entity) and must not be seeded under acme.
const DEMO_ASSETS = [
  { coinType: '0x2::sui::SUI' },
  { coinType: '0xbeef::usdc::USDC', decimals: 6, symbol: 'USDC', reason: 'demo placeholder coin type; no on-chain metadata' },
  { coinType: '0xcafe::weth::WETH', decimals: 8, symbol: 'WETH', reason: 'demo placeholder coin type; no on-chain metadata' },
  { coinType: '0xdead::usdt::USDT', decimals: 6, symbol: 'USDT', reason: 'demo placeholder coin type; no on-chain metadata' },
];

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  const fetcher: CoinInfoFetcher = makeGrpcCoinInfoFetcher(makeGrpcClient(cfg), 8000);
  for (const a of DEMO_ASSETS) {
    const { status, row } = await registerAsset(db, fetcher, { entityId: ENTITY, ...a, actor: 'seed-assets', now: new Date().toISOString() });
    console.log(`${status} ${row.coinType} decimals=${row.decimals} source=${row.source}`);
  }
}
void main();
```

> `loadConfig`'s real export name and `cfg.dbPath`'s real key are in `services/api/src/config.ts`.
> Read it and match.

- [ ] **Step 2: `spike-coin-info.ts` — prove the call shape against a real node**

```typescript
/**
 * One-shot spike, not a test. signAndExecuteTransaction once cost this project three bugs
 * because its call shape was assumed rather than observed. getCoinMetadata is now known to
 * coerce; verify the raw stateService path returns decimals: 9 for real SUI.
 */
import { makeGrpcClient } from '../src/grpcClient.js';
import { loadConfig } from '../src/config.js';

async function main(): Promise<void> {
  const grpc = makeGrpcClient(loadConfig());
  const { response } = await grpc.stateService.getCoinInfo({ coinType: '0x2::sui::SUI' });
  console.log(JSON.stringify({ decimals: response.metadata?.decimals, symbol: response.metadata?.symbol,
    id: response.metadata?.id, version: response.metadata?.version }, null, 2));
  if (response.metadata?.decimals !== 9) throw new Error(`expected 9, got ${String(response.metadata?.decimals)}`);
  console.log('OK — raw proto decimals is 9 and is not coerced');
}
void main();
```

- [ ] **Step 3: Add scripts to `services/api/package.json`**

```json
"seed:assets": "tsx scripts/seed-assets.ts",
"spike:coininfo": "tsx scripts/spike-coin-info.ts"
```

- [ ] **Step 4: Run the live spike**

Run: `cd services/api && set -a && . ./.env && set +a && npm run spike:coininfo`
Expected: prints `decimals: 9` and `OK`.
**If it fails, stop and report.** The whole D14 branch rests on this call shape.

- [ ] **Step 4b: Close the seeder's bypass of the ingest gate**

`src/store/seed.ts` writes fixture events with `insertEvent()`, not `ingestEvent()` — and
`server.ts` calls `seed()` on start. So seeded events never meet the registry gate, and defect
A is only half closed.

Do **not** fix this by deriving the registry from the fixture's `assetDecimals`. That is
precisely the "infer master data from transactions" D1 rejects; hiding it inside the seeder
would not make it not that.

Fix the ordering instead:
1. `seed()` registers `DEMO_ASSETS` (the explicit list above) **first**, via `insertAssetIfAbsent`
   for the offline path or `registerAsset` when a fetcher is available.
2. Then it routes each fixture event through `ingestEvent()` rather than `insertEvent()`.
3. A fixture event whose `assetDecimals` contradicts the registered value now **fails the seed
   loudly**. That is the point: it means the demo fixture is internally inconsistent.

Update `ingest.noBypass.test.ts` (Task 6, Step 6b) to expect `store/seed.ts` to be gone from
the caller list, leaving `{ http/ingestEvent.ts, store/eventStore.ts }`. Run it before the
change (must be green with seed.ts listed) and after (green without it) — that transition is
the proof the bypass actually closed.

- [ ] **Step 4c: Prove D5 with a test, not with an argument**

D5 — "the registry validates `assetDecimals`, it does not replace it, so leaf hashes, merkle
roots and every previously anchored snapshot stay byte-identical" — is the most valuable
property in this design. It buys zero re-anchor.

Today it is supported by inspection (`rawJson` is stored verbatim; `insertEvent`'s call site is
unchanged; zero rules-engine files touched) and by the fact that the snapshot suite stayed
green. **Neither is a test that would go red** if someone later "optimised" `ingestEvent` into
re-serialising the payload.

It could not be written earlier: proving it needs a full ingest → run-rules → snapshot path
that goes *through the gate*, and until Step 4b that path was bypassed by `seed()`.

Add `services/api/test/ingest.d5Parity.test.ts`:

1. Register the asset, ingest a coinType-bearing event **through `ingestEvent()`**.
2. Run rules, build a snapshot, record `merkleRoot` and `manifestHash`.
3. In a second DB, write the same event with `insertEvent()` directly (the pre-gate path),
   run the same pipeline, record the same two values.
4. `expect(gated.merkleRoot).toBe(ungated.merkleRoot)` and the same for `manifestHash`.

Then mutation-test it: make `ingestEvent` store `JSON.stringify(JSON.parse(rawJson))` instead
of `rawJson`. Key order survives that round-trip, so if the assertion stays green, strengthen
it — pin the stored `raw_json` string byte-for-byte as well.

- [ ] **Step 5: Seed and drive the app**

```bash
cd services/api && set -a && . ./.env && set +a && npm run seed:assets
```
Expected: `201` for all five; SUI reports `source=chain`, the other four `source=manual`.

Then start api (`npm start`) and web (`cd web && npm run dev`), hard-reload, and with Playwright walk:
1. Onboarding → registry panel lists five assets, SUI `↗ chain-verified` (aqua), four `✎ manual · unverified` (brass)
2. Reconciliation → no unregistered pills; precision profile visible on the SUI and USDC breaks
3. Close cockpit → `registry` light green; click it → routes to onboarding
4. Export → bundle builds; manual-disclosure card lists four assets; `journal.csv` has `origDecimals` / `origQty` / `origSource`
5. Delete a registry row via `DELETE /entities/acme:pilot-001/assets/<encoded>` for an unused coinType, reload → that asset shows `⛔ Unregistered`, ReconDetail offers no Dismiss, export refuses, cockpit light red

Screenshot at 390px, 640px and 1024px. Console must be error-free.

- [ ] **Step 6: Full verification**

```bash
cd services/api && npm test && npm run typecheck
cd ../rules-engine && npm test
cd ../../web && npm test && npm run typecheck && npm run build
cd .. && npx tsc --noEmit
git diff main...HEAD --stat -- '*.move'
```

Report every count. The `.move` diff must be empty — `sui move test` is **not applicable**, not skipped. State that explicitly.

- [ ] **Step 7: Commit**

```bash
git add services/api/scripts/seed-assets.ts services/api/scripts/spike-coin-info.ts services/api/package.json
git commit -m "chore(assets): explicit demo seeding + live getCoinInfo spike

Seeding is a script, not a migration: deriving the registry from existing event
payloads is precisely the 'infer master data from transactions' that D1
rejects, and hiding it in a migration would not make it not that.

Only 0x2::sui::SUI exists on chain; the four placeholder coin types register as
source='manual' and the export discloses exactly that."
```

---

## Self-Review

**Spec coverage.** §2.1 completeness disclaimer → doc-only, no task (spec §2.1 states it; nothing to build). §3.1 close-window flagging → **gap**: no task records or surfaces "registered during the close window". §4.3 log-anchoring → deferred (§10-4). §6.5.5 card-ification → Task 10 CSS. §7.3 profile effect boundary → Task 9 copy (`whole-unit break — not rounding`) plus the spec's own §7.3. Everything else maps to Tasks 1-12.

**Gap fix — fold into Task 11 Step 3c**, since that is where disclosure is rendered:

- [ ] **Task 11, Step 3d: close-window registration disclosure**

`asset_registry.created_at` already exists. In `ExportWorkspace.tsx`'s manual-disclosure card, additionally flag any asset whose `createdAt` falls after the period's lock timestamp, with the copy: *"Registered during the close window"*. Add one test asserting the flag appears for a `createdAt` after the lock and not before. This is the §3.1 minimum compensating control; it is **not** segregation of duties, which needs H1.

**Placeholder scan.** Three tasks carry explicit "read the real signature before filling this in" notes (Task 8's `buildCockpit`, Task 9's component props, Task 11's `buildBundle` fixtures) rather than inventing APIs I have not read. Task 12's `loadConfig`/`cfg.dbPath` likewise. No `TBD`, no "add appropriate error handling".

**Type consistency.** `AssetInfo` (Task 4) is what `getAssetDecimals` returns; `AssetRow` (Task 3) is the DB row. `collect.ts` reads `asset?.decimals`, `asset?.symbol`, `asset?.source` — all present on `AssetInfo`. `BreakPrecision` is defined once in Task 2 and re-declared structurally in `web/src/api/types.ts` (Task 9) because web does not import from api. `CoinInfoFetcher.getCoinInfo` resolves `RawCoinInfo | null` and throws `ChainUnreachableError`; `makeGrpcCoinInfoFetcher` and all four test doubles honour that contract. `registerAsset` throws `RegisterError` with `{status, code}`; the route maps it to `ApiError` with the same pair; `AssetRegistryPanel`'s `ERR` map keys on exactly those codes: `INVALID_COIN_TYPE`, `NAMED_PACKAGE_UNSUPPORTED`, `MANUAL_DECIMALS_REQUIRED`, `CHAIN_DECIMALS_MISMATCH`, `ASSET_DECIMALS_CONFLICT`, `ASSET_IN_USE`, `CHAIN_UNREACHABLE`. `unregisteredAssetBlockers` returns `ReconBreak[]` in all five backend call sites.

**Known ordering hazard.** Task 6 breaks roughly ten existing test files (every one that ingests an event) and Task 7 breaks four more. Both tasks own their repair step. A reviewer seeing a red suite mid-task should check the task's repair step before assuming a defect. **Never weaken the gate to make an old test pass.**
