# Export Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `export` workspace that lets the browser assemble a verifiable, portable accounting bundle (ERP CSV + audit ZIP) whose every trust-path number is client-recomputed end-to-end (CSV → leaf → Merkle root → on-chain anchor), with verified/draft states and a pre-download self-verification summary.

**Architecture:** Frontend assembles and verifies the bundle; the backend never assembles it. Pure functions (`leafEncode`, `trialActivity`, `quantityRecon`, `csv`, `buildBundle`) are TDD'd in isolation; an async orchestrator (`assembleExport`) fetches data, recomputes leaf hashes (byte-identical to the on-chain leaf codec, pinned by a parity test), resolves the period anchor, verifies inclusion proofs, and zips via `fflate`. One additive backend change exposes `periodId` + `leafCount` on the existing `AnchorDTO` snapshot join (read-only).

**Tech Stack:** TypeScript, React, Vite, Vitest, `@mysten/sui/bcs` (BCS, already present), WebCrypto SHA-256, `fflate` (new, ZIP). Backend: Fastify + better-sqlite3 (existing).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-24-export-workspace-design.md`. Every task's requirements implicitly include it.
- Leaf preimage is FROZEN (`JE_LEAF_BCS_V1`): BCS `{ idempotencyKey, reversalOf, lines:[{account, side:u8(DEBIT=0/CREDIT=1), amountMinor, origCoinType, origQtyMinor, priceRef, fxRef, leg}] }`; `leafHash = SHA-256(0x00 || bcsBytes)`; node = `SHA-256(0x01 || left || right)`. Source of truth: `services/rules-engine/src/core/leafCodec.ts` + `web/src/lib/proofVerify.ts`. The web `leafEncode` MUST stay byte-identical — pinned by a parity test (merge gate), exactly like `services/api/test/recon.parity.test.ts`.
- All monetary `amountMinor` are non-negative minor-unit integer strings; direction is carried only by `side`. A negative amount is fail-loud, never emitted.
- Money/amount fields use BigInt, never JS number, never float.
- No silent truncation anywhere (hashes, journals, counts). Fail loud on every integrity violation; never emit a half-built bundle.
- Web design system: navy `--ink` / brass / cream `--paper`; reuse `.austere`, `.aqua-link`, `.btn-primary`, `.card`, `.light--mock`, `.light--red` from `web/src/styles/base.css` + `web/src/workspaces/close/close.css`. Non-color dual-axis encoding (icon+label, texture, structure) — never color alone. Otter mascot only in empty/chrome, never on data surfaces.
- Run web tests: `cd web && npm run test`. Build gate: `cd web && npm run build` (exit 0). Backend tests: `cd services/api && npm test`.
- Repo is the EXISTING git repo at the project root. NEVER run `git init`. Commit from repo root. Branch: `feat/export-workspace` (already created).

---

## File Structure

**Backend (1 additive change):**
- Modify `services/api/src/http/routes.ts` — anchors route: include `periodId` + `leafCount` from the snapshot join.
- Modify `web/src/api/types.ts` — add `periodId: string` + `leafCount: number` to `AnchorDTO`.

**Frontend pure libs (`web/src/lib/`):**
- Create `leafEncode.ts` — BCS-encode a JE + `leafHash = SHA-256(0x00||bytes)`. Mirror of `leafCodec.ts`. (+ parity test)
- Create `trialActivity.ts` — per-account functional-ccy DR/CR totals + `debits==credits` + `amount>=0` invariants.
- Create `quantityRecon.ts` — per-coinType acquired/disposed/net `origQtyMinor`.
- Create `exportCsv.ts` — CSV row builder: field escaping + CSV-injection guard + raw number format + book-header block.

**Frontend bundle + orchestration (`web/src/workspaces/export/`):**
- Create `buildBundle.ts` — pure: assemble the 6 files + manifest + summary from already-verified inputs.
- Create `assembleExport.ts` — async orchestrator: data → leaf recompute → anchor resolve → proof verify → completeness → buildBundle → zip.
- Create `ExportWorkspace.tsx` — landing UI (status card, summary, error/empty states, download).
- Create `export.css` — workspace styles (reusing tokens).

**Frontend data (`web/src/data/`):**
- Create `useExportData.ts` — fetch journal+events+anchors, render-gate by entityId.

**Wiring:**
- Modify `web/src/app/workspaces.ts` — `export` status `soon` → `ready`.
- Modify the App workspace dispatch (wherever `audit`/`close` render) to mount `ExportWorkspace`.

**Dependency:** add `fflate` to `web/package.json`.

---

## Task 1: Expose `periodId` + `leafCount` on AnchorDTO (backend additive)

**Files:**
- Modify: `services/api/src/http/routes.ts` (the `GET /entities/:id/anchors` handler — currently around line 549)
- Modify: `web/src/api/types.ts:66-75` (`AnchorDTO`)
- Test: `services/api/test/` (anchors route test — find the existing one, else add to the routes test file)

**Interfaces:**
- Produces: `AnchorDTO` now additionally carries `periodId: string` and `leafCount: number`, both joined from the anchored snapshot (same join that already produces `merkleRoot`).

- [ ] **Step 1: Read the current anchors handler and the snapshot join**

Run: `grep -n "anchors" services/api/src/http/routes.ts` and read the handler + how `merkleRoot` is currently joined onto each anchor (look for the snapshot lookup by `snapshotId`). Note the snapshot row already provides `period_id` and `leaf_count`.

- [ ] **Step 2: Write the failing test**

In the api test that covers `/anchors` (search: `grep -rln "anchors" services/api/test`), add:

```ts
it('anchors expose periodId and leafCount from the snapshot join', async () => {
  // Arrange: an entity with a FROZEN snapshot + anchor (reuse the test's existing
  // freeze+anchor helper / fixture used by other anchor tests).
  const res = await app.inject({ method: 'GET', url: `/entities/${entityId}/anchors` });
  expect(res.statusCode).toBe(200);
  const { anchors } = res.json();
  expect(anchors.length).toBeGreaterThan(0);
  for (const a of anchors) {
    expect(typeof a.periodId).toBe('string');
    expect(a.periodId.length).toBeGreaterThan(0);
    expect(Number.isInteger(a.leafCount)).toBe(true);
    expect(a.leafCount).toBeGreaterThanOrEqual(0);
  }
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd services/api && npm test -- -t "periodId and leafCount"`
Expected: FAIL (`periodId`/`leafCount` undefined).

- [ ] **Step 4: Add the two fields to the join in the handler**

In the anchors handler, where each anchor is mapped and `merkleRoot` is set from the looked-up snapshot, also set `periodId: snap.periodId` (DB col `period_id`) and `leafCount: snap.leafCount` (DB col `leaf_count`). If `merkleRoot` is currently `snap?.merkle_root ?? null`, mirror that null-safety: `periodId: snap?.period_id ?? ''`, `leafCount: snap?.leaf_count ?? 0` — but prefer to keep the existing pattern used for merkleRoot exactly.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd services/api && npm test -- -t "periodId and leafCount"`
Expected: PASS. Then full suite: `cd services/api && npm test` → all green.

- [ ] **Step 6: Update the web DTO type**

In `web/src/api/types.ts`, `AnchorDTO`:
```ts
export interface AnchorDTO {
  id: string;
  snapshotId: string;
  seq: number;
  link: string;
  digest: string;
  explorerUrl: string;
  anchoredAt: string;
  merkleRoot: string | null;
  periodId: string;   // joined from the anchored snapshot (Task 1, export)
  leafCount: number;  // joined from the anchored snapshot (Task 1, export)
}
```

- [ ] **Step 7: Verify web still typechecks + commit**

Run: `cd web && npx tsc --noEmit` → clean (no consumer breaks; fields are additive).
```bash
git add services/api/src/http/routes.ts services/api/test web/src/api/types.ts
git commit -m "feat(export): expose periodId+leafCount on AnchorDTO snapshot join (read-only)"
```

---

## Task 2: `leafEncode.ts` — client leaf-hash recompute (parity-pinned)

**Files:**
- Create: `web/src/lib/leafEncode.ts`
- Test: `web/src/lib/leafEncode.test.ts`
- Test fixture: `web/src/lib/__fixtures__/golden-journal.json` (captured real `JournalDTO[]`)

**Interfaces:**
- Consumes: `JournalEntryBody` from `web/src/api/types.ts` (`{ idempotencyKey, lineageHash, reversalOf, lines: JournalLine[] }`).
- Produces: `export async function leafHash(je: JournalEntryBody): Promise<string>` — lowercase hex, 64 chars. MUST equal the backend's `JournalDTO.leafHash`.

- [ ] **Step 1: Capture a golden journal fixture**

Start the API (`cd services/api && npm start`, port 8787) and capture a real journal (it carries backend `leafHash` values — the parity oracle):
```bash
curl -s http://localhost:8787/entities/acme:pilot-001/journal > web/src/lib/__fixtures__/golden-journal.json
```
Confirm the file is a non-empty array where each element has `je.lines[]` and a `leafHash`. (If the entity has no journal yet, run ingest→classify→run-rules first, or copy the entityId from `services/api/src/fixtures/`.) Stop the API.

- [ ] **Step 2: Write the failing parity test**

`web/src/lib/leafEncode.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import golden from './__fixtures__/golden-journal.json';
import { leafHash } from './leafEncode';
import type { JournalDTO } from '../api/types';

describe('leafEncode parity (MERGE GATE — must equal on-chain leaf codec)', () => {
  const rows = golden as unknown as JournalDTO[];

  it('fixture is non-empty and every row has a 64-hex leafHash', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(/^[0-9a-f]{64}$/.test(r.leafHash)).toBe(true);
  });

  it('recomputes each JE leafHash byte-identically to the backend', async () => {
    // WHY: this is the L2 spine — if web and backend diverge by one byte, the
    // exported bundle binds to leaves the recipient cannot reproduce, and the
    // "client-recomputable" claim is false. Reversal entries (reversalOf!=null)
    // and null-origin legs are included on purpose.
    for (const r of rows) {
      expect(await leafHash(r.je)).toBe(r.leafHash.toLowerCase());
    }
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd web && npm run test -- leafEncode`
Expected: FAIL (`leafEncode` not found).

- [ ] **Step 4: Implement `leafEncode.ts`**

```ts
// DATA ZONE (spec §8.4) — NEVER import Mascot here.
// Byte-identical mirror of services/rules-engine/src/core/leafCodec.ts (JE_LEAF_BCS_V1)
// + the leaf hashing in services/rules-engine/src/core/merkle.ts:
//   leaf = SHA-256(0x00 || BCS(JournalEntryLeaf))
// Pinned by leafEncode.test.ts against real backend leafHash values (merge gate).
import { bcs } from '@mysten/sui/bcs';
import type { JournalEntryBody, JournalLine } from '../api/types';

const LEAF_PREFIX = 0x00;

const JeLineBcs = bcs.struct('JeLineBcs', {
  account: bcs.string(),
  side: bcs.u8(),                       // DEBIT = 0, CREDIT = 1
  amountMinor: bcs.string(),
  origCoinType: bcs.option(bcs.string()),
  origQtyMinor: bcs.option(bcs.string()),
  priceRef: bcs.option(bcs.string()),
  fxRef: bcs.option(bcs.string()),
  leg: bcs.string(),
});

const JournalEntryLeaf = bcs.struct('JournalEntryLeaf', {
  idempotencyKey: bcs.string(),
  reversalOf: bcs.option(bcs.string()),
  lines: bcs.vector(JeLineBcs),
});

function sideToU8(side: JournalLine['side']): number {
  if (side === 'DEBIT') return 0;
  if (side === 'CREDIT') return 1;
  throw new Error(`leafEncode: invalid side ${String(side)}`);
}

export function encodeJeLeaf(je: JournalEntryBody): Uint8Array {
  return JournalEntryLeaf.serialize({
    idempotencyKey: je.idempotencyKey,
    reversalOf: je.reversalOf,
    lines: je.lines.map((l) => ({
      account: l.account,
      side: sideToU8(l.side),
      amountMinor: l.amountMinor,
      origCoinType: l.origCoinType,
      origQtyMinor: l.origQtyMinor,
      priceRef: l.priceRef,
      fxRef: l.fxRef,
      leg: String(l.leg), // JournalLine.leg is typed `unknown` in the web DTO; it is a string at runtime
    })),
  }).toBytes();
}

export async function leafHash(je: JournalEntryBody): Promise<string> {
  const body = encodeJeLeaf(je);
  const prefixed = new Uint8Array(1 + body.length);
  prefixed[0] = LEAF_PREFIX;
  prefixed.set(body, 1);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', prefixed.buffer as ArrayBuffer));
  return [...digest].map((x) => x.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd web && npm run test -- leafEncode`
Expected: PASS. If the hash differs, the divergence is in BCS field order/types or the leaf prefix — re-read `leafCodec.ts` + `merkle.ts`, DO NOT change the test to match a wrong encoder.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/leafEncode.ts web/src/lib/leafEncode.test.ts web/src/lib/__fixtures__/golden-journal.json
git commit -m "feat(export): client leaf-hash recompute, parity-pinned to on-chain codec"
```

---

## Task 3: `trialActivity.ts` — per-account activity + invariants

**Files:**
- Create: `web/src/lib/trialActivity.ts`
- Test: `web/src/lib/trialActivity.test.ts`

**Interfaces:**
- Consumes: `JournalLine[]` (`{ account, side, amountMinor, ... }`).
- Produces:
  ```ts
  export interface AccountActivity { account: string; debitMinor: bigint; creditMinor: bigint }
  export interface ActivityResult { rows: AccountActivity[]; totalDebitMinor: bigint; totalCreditMinor: bigint }
  export function trialActivity(lines: JournalLine[]): ActivityResult  // throws on imbalance / negative
  export class ImbalanceError extends Error { constructor(public debit: bigint, public credit: bigint) }
  ```

- [ ] **Step 1: Write the failing tests**

`web/src/lib/trialActivity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { trialActivity, ImbalanceError } from './trialActivity';
import type { JournalLine } from '../api/types';

const L = (account: string, side: 'DEBIT' | 'CREDIT', amountMinor: string): JournalLine =>
  ({ account, side, amountMinor, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'X' });

describe('trialActivity', () => {
  it('sums per account and reports balanced totals', () => {
    const r = trialActivity([L('asset', 'DEBIT', '1000'), L('ar', 'CREDIT', '1000')]);
    expect(r.totalDebitMinor).toBe(1000n);
    expect(r.totalCreditMinor).toBe(1000n);
    expect(r.rows.find((x) => x.account === 'asset')!.debitMinor).toBe(1000n);
  });

  it('aggregates multiple legs on the same account', () => {
    const r = trialActivity([L('asset', 'DEBIT', '600'), L('asset', 'DEBIT', '400'), L('ar', 'CREDIT', '1000')]);
    expect(r.rows.find((x) => x.account === 'asset')!.debitMinor).toBe(1000n);
  });

  it('THROWS ImbalanceError when debits != credits (WHY: an unbalanced export is corrupt evidence)', () => {
    try {
      trialActivity([L('asset', 'DEBIT', '1000'), L('ar', 'CREDIT', '999')]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ImbalanceError);
      expect((e as ImbalanceError).debit).toBe(1000n);
      expect((e as ImbalanceError).credit).toBe(999n);
    }
  });

  it('THROWS on a negative amount (WHY: direction is carried by side; negatives corrupt ERP import)', () => {
    expect(() => trialActivity([L('asset', 'DEBIT', '-5'), L('ar', 'CREDIT', '-5')]))
      .toThrow(/non-negative|negative/i);
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `cd web && npm run test -- trialActivity` → FAIL.

- [ ] **Step 3: Implement**

```ts
// DATA ZONE — NEVER import Mascot here.
import type { JournalLine } from '../api/types';

export interface AccountActivity { account: string; debitMinor: bigint; creditMinor: bigint }
export interface ActivityResult { rows: AccountActivity[]; totalDebitMinor: bigint; totalCreditMinor: bigint }

export class ImbalanceError extends Error {
  constructor(public debit: bigint, public credit: bigint) {
    super(`books do not balance: debit ${debit} != credit ${credit}`);
    this.name = 'ImbalanceError';
  }
}

export function trialActivity(lines: JournalLine[]): ActivityResult {
  const byAccount = new Map<string, AccountActivity>();
  let totalDebit = 0n;
  let totalCredit = 0n;
  for (const l of lines) {
    const amt = BigInt(l.amountMinor);
    if (amt < 0n) throw new Error(`trialActivity: amountMinor must be non-negative, got ${l.amountMinor} on ${l.account}`);
    const row = byAccount.get(l.account) ?? { account: l.account, debitMinor: 0n, creditMinor: 0n };
    if (l.side === 'DEBIT') { row.debitMinor += amt; totalDebit += amt; }
    else { row.creditMinor += amt; totalCredit += amt; }
    byAccount.set(l.account, row);
  }
  if (totalDebit !== totalCredit) throw new ImbalanceError(totalDebit, totalCredit);
  const rows = [...byAccount.values()].sort((a, b) => a.account.localeCompare(b.account));
  return { rows, totalDebitMinor: totalDebit, totalCreditMinor: totalCredit };
}
```

- [ ] **Step 4: Run to confirm pass** — `cd web && npm run test -- trialActivity` → PASS.

- [ ] **Step 5: Commit**
```bash
git add web/src/lib/trialActivity.ts web/src/lib/trialActivity.test.ts
git commit -m "feat(export): per-account period activity with balance+non-negative invariants"
```

---

## Task 4: `quantityRecon.ts` — per-coinType quantity reconciliation

**Files:**
- Create: `web/src/lib/quantityRecon.ts`
- Test: `web/src/lib/quantityRecon.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CoinRecon { coinType: string; acquiredMinor: bigint; disposedMinor: bigint; netMinor: bigint }
  export function quantityRecon(lines: JournalLine[]): CoinRecon[]  // sorted by coinType; skips null-origin legs
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { quantityRecon } from './quantityRecon';
import type { JournalLine } from '../api/types';

const QL = (side: 'DEBIT' | 'CREDIT', coin: string | null, qty: string | null): JournalLine =>
  ({ account: 'a', side, amountMinor: '0', origCoinType: coin, origQtyMinor: qty, priceRef: null, fxRef: null, leg: 'X' });

describe('quantityRecon', () => {
  it('nets acquired (DEBIT) minus disposed (CREDIT) per coinType', () => {
    const r = quantityRecon([QL('DEBIT', '0x2::sui::SUI', '100'), QL('CREDIT', '0x2::sui::SUI', '30')]);
    expect(r).toEqual([{ coinType: '0x2::sui::SUI', acquiredMinor: 100n, disposedMinor: 30n, netMinor: 70n }]);
  });
  it('skips legs with null origCoinType/origQty (pure-fiat legs)', () => {
    expect(quantityRecon([QL('DEBIT', null, null)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `cd web && npm run test -- quantityRecon` → FAIL.

- [ ] **Step 3: Implement**

```ts
// DATA ZONE — NEVER import Mascot here.
import type { JournalLine } from '../api/types';

export interface CoinRecon { coinType: string; acquiredMinor: bigint; disposedMinor: bigint; netMinor: bigint }

export function quantityRecon(lines: JournalLine[]): CoinRecon[] {
  const byCoin = new Map<string, { acquired: bigint; disposed: bigint }>();
  for (const l of lines) {
    if (!l.origCoinType || !l.origQtyMinor) continue;
    const q = BigInt(l.origQtyMinor);
    if (q < 0n) throw new Error(`quantityRecon: origQtyMinor must be non-negative, got ${l.origQtyMinor}`);
    const c = byCoin.get(l.origCoinType) ?? { acquired: 0n, disposed: 0n };
    if (l.side === 'DEBIT') c.acquired += q; else c.disposed += q;
    byCoin.set(l.origCoinType, c);
  }
  return [...byCoin.entries()]
    .map(([coinType, v]) => ({ coinType, acquiredMinor: v.acquired, disposedMinor: v.disposed, netMinor: v.acquired - v.disposed }))
    .sort((a, b) => a.coinType.localeCompare(b.coinType));
}
```

- [ ] **Step 4: Run to confirm pass** — `cd web && npm run test -- quantityRecon` → PASS.

- [ ] **Step 5: Commit**
```bash
git add web/src/lib/quantityRecon.ts web/src/lib/quantityRecon.test.ts
git commit -m "feat(export): per-coinType quantity reconciliation"
```

---

## Task 5: `exportCsv.ts` — CSV rows with escaping, injection guard, header block

**Files:**
- Create: `web/src/lib/exportCsv.ts`
- Test: `web/src/lib/exportCsv.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function csvField(value: string): string             // escape one field (quotes + injection guard)
  export function csvRows(header: string[], rows: string[][]): string  // header + rows, CRLF-free \n, no BOM
  export function headerBlock(meta: Record<string, string>): string    // '# key: value' comment lines
  export function formatMinor(amountMinor: string, scale: number): string  // raw fixed-decimal, no thousands sep
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { csvField, csvRows, formatMinor, headerBlock } from './exportCsv';

describe('exportCsv', () => {
  it('quotes fields containing comma, quote, or newline (doubling inner quotes)', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('plain')).toBe('plain');
  });
  it('guards CSV-injection prefixes by prepending a single quote (WHY: =cmd in a cell executes in Excel)', () => {
    for (const p of ['=', '+', '-', '@']) {
      expect(csvField(`${p}cmd`)).toBe(`"'${p}cmd"`);
    }
  });
  it('formats minor units at scale with no thousands separator', () => {
    expect(formatMinor('123456', 2)).toBe('1234.56');
    expect(formatMinor('5', 2)).toBe('0.05');
    expect(formatMinor('0', 2)).toBe('0.00');
  });
  it('joins header + rows with \\n', () => {
    expect(csvRows(['a', 'b'], [['1', '2']])).toBe('a,b\n1,2');
  });
  it('emits # comment header lines', () => {
    expect(headerBlock({ entityId: 'acme', periodId: '2026-06' }))
      .toBe('# entityId: acme\n# periodId: 2026-06');
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `cd web && npm run test -- exportCsv` → FAIL.

- [ ] **Step 3: Implement**

```ts
// DATA ZONE — NEVER import Mascot here.
const INJECTION = new Set(['=', '+', '-', '@']);

export function csvField(value: string): string {
  let v = value;
  const needsInjectionGuard = v.length > 0 && INJECTION.has(v[0]);
  if (needsInjectionGuard) v = `'${v}`;
  const needsQuote = needsInjectionGuard || /[",\n\r]/.test(v);
  if (needsQuote) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function csvRows(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((cols) => cols.map(csvField).join(','));
  return lines.join('\n');
}

export function headerBlock(meta: Record<string, string>): string {
  return Object.entries(meta).map(([k, v]) => `# ${k}: ${v}`).join('\n');
}

export function formatMinor(amountMinor: string, scale: number): string {
  const neg = amountMinor.startsWith('-');
  const digits = (neg ? amountMinor.slice(1) : amountMinor).padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale) || '0';
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}
```
Note: `csvField` applies the injection guard before the quote test, and a guarded field is always quoted (so the leading `'` can't be re-interpreted). `formatMinor` keeps a sign only defensively; upstream invariants forbid negatives.

- [ ] **Step 4: Run to confirm pass** — `cd web && npm run test -- exportCsv` → PASS.

- [ ] **Step 5: Commit**
```bash
git add web/src/lib/exportCsv.ts web/src/lib/exportCsv.test.ts
git commit -m "feat(export): CSV builder with escaping, injection guard, header block, minor-unit format"
```

---

## Task 6: `buildBundle.ts` — pure bundle assembly

**Files:**
- Create: `web/src/workspaces/export/buildBundle.ts`
- Test: `web/src/workspaces/export/buildBundle.test.ts`

**Interfaces:**
- Consumes: `trialActivity`, `quantityRecon`, `exportCsv`, DTO types. Verification results (leaf-bound, proofs, anchor) are passed IN — buildBundle does no async/IO.
- Produces:
  ```ts
  export interface BundleInput {
    entityId: string; periodId: string; functionalCurrency: string; scale: number; generatedAt: string;
    journal: JournalDTO[];
    dateByEventId: Record<string, string>;          // resolved event dates (ISO)
    binding: null | {                               // null => draft (unanchored)
      anchor: { merkleRoot: string; snapshotId: string; digest: string; explorerUrl: string; leafCount: number };
      proofs: InclusionProof[];                      // one per JE, leaf-bound & root-verified upstream
    };
    policySetVersion?: string;
  }
  export interface BundleSummary {
    jeCount: number; legCount: number;
    totalDebit: string; totalCredit: string;        // formatted
    verified: boolean;
    merkleRootMatches?: boolean; leavesBound?: number; proofsVerified?: number;
    bundledJeCount?: number; anchoredLeafCount?: number; completenessOk?: boolean;
  }
  export interface BuiltBundle { files: { name: string; content: string }[]; verified: boolean; manifest: object; summary: BundleSummary }
  export async function buildBundle(input: BundleInput): Promise<BuiltBundle>  // async only for file sha256
  ```

- [ ] **Step 1: Write the failing tests** (verified path + draft path + completeness)

`web/src/workspaces/export/buildBundle.test.ts`: assert that
- a verified input (binding present, `proofs.length === journal.length`, `anchor.leafCount === journal.length`) yields `verified: true`, a `manifest.json` file whose parsed content has `verified:true`, non-null `anchor`, `inclusionProofs.length === journal.length`, `completeness.bundledJeCount === completeness.anchoredLeafCount`, filename list includes `journal.csv/account-activity.csv/quantity-recon.csv/journal.json/manifest.json/VERIFY.md`, and `summary.completenessOk === true`;
- a draft input (`binding: null`) yields `verified: false`, manifest `verified:false`, `anchor:null`, no `inclusionProofs`, and `summary.verified === false`;
- the manifest's `files[]` does **not** include `manifest.json` itself, and every listed file's `sha256` is 64-hex;
- a completeness mismatch (`anchor.leafCount !== journal.length`) yields `summary.completenessOk === false` AND `buildBundle` throws (do not emit a "verified" bundle that fails completeness).

(Write each as a concrete `it(...)` with a small 2-JE fixture built from the `L(...)`-style helpers; reuse a balanced pair so `trialActivity` doesn't throw.)

- [ ] **Step 2: Run to confirm fail** — FAIL (`buildBundle` not found).

- [ ] **Step 3: Implement**

Key logic:
- Flatten journal → leg rows for `journal.csv` with columns `date,reference,reversalOf,account,leg,debit,credit,currency,origCoinType,origQtyMinor,priceRef,fxRef`. `date = dateByEventId[row.eventId]` — if missing, throw (fail-loud). `debit`/`credit` via `formatMinor(amountMinor, scale)` placed by side.
- `account-activity.csv` from `trialActivity(allLines)` (throws on imbalance/negative — let it propagate).
- `quantity-recon.csv` from `quantityRecon(allLines)`.
- `journal.json` = `JSON.stringify(journal.map(r => r.je), null, 2)` (canonical leaf preimage source).
- If `binding`: assert `binding.anchor.leafCount === journal.length` else throw `Error('completeness: bundledJeCount != anchoredLeafCount')`; `verified = true`.
- `manifest`: build with `files[]` = sha256 of each non-manifest file (await `crypto.subtle.digest` over `new TextEncoder().encode(content)`), `completeness`, `verified`, `anchor` (or null), `inclusionProofs` (or omitted), `leafCodecVersion: 'JE_LEAF_BCS_V1'`, `generatedAt`, `entityId`, `periodId`.
- `summary` mirrors the manifest's headline numbers (formatted totals from `trialActivity`).
- Each CSV is prefixed with `headerBlock({...})` + `\n`.

- [ ] **Step 4: Run to confirm pass** — PASS.

- [ ] **Step 5: Commit**
```bash
git add web/src/workspaces/export/buildBundle.ts web/src/workspaces/export/buildBundle.test.ts
git commit -m "feat(export): pure bundle assembly (6 files + manifest + summary, completeness-gated)"
```

---

## Task 7: `useExportData.ts` — entity-scoped fetch with render-gate

**Files:**
- Create: `web/src/data/useExportData.ts`
- Test: `web/src/data/useExportData.test.tsx`

**Interfaces:**
- Produces: `useExportData(entityId: string): { data?: { journal: JournalDTO[]; events: EventDTO[]; anchors: AnchorDTO[] }; loading: boolean; error?: string }` — `data` is exposed only when it belongs to the current `entityId` (render-gate, NOT a post-commit effect).

- [ ] **Step 1: Read the reference pattern**

Read `web/src/data/useCloseCockpit.ts` (the post-2026-06-24 render-gated version) and mirror its `{entityId, value}` storage + key-match exposure exactly. WHY: prior codex review caught a stale-data race where a post-commit effect let a late other-entity response surface; the render-gate stores data tagged with its entityId and exposes it only on a match.

- [ ] **Step 2: Write the failing test**

A test using a deferred (manually-resolved) fetch mock that resolves an OLD entity's request AFTER the hook has switched to a NEW entity, asserting the hook never exposes the old entity's data for the new entityId. (Mirror `useCloseCockpit.test.tsx`'s race test — copy its deferred-mock harness; do NOT use an immediate mock that `act()` would flush.)

- [ ] **Step 3: Run to confirm fail** — FAIL.

- [ ] **Step 4: Implement** — mirror `useCloseCockpit.ts`: fetch `getJournal`, `listEvents`, `getAnchors` (no idempotencyKey → entity anchors) in parallel; store `{ entityId, value }`; expose `state.entityId === entityId ? state.value : undefined`; bump a genRef to drop out-of-order resolves; set `error` on rejection (fail-loud, not silent).

- [ ] **Step 5: Run to confirm pass** — PASS.

- [ ] **Step 6: Commit**
```bash
git add web/src/data/useExportData.ts web/src/data/useExportData.test.tsx
git commit -m "feat(export): entity-scoped export data hook with render-gate (no stale race)"
```

---

## Task 8: `assembleExport.ts` — async orchestrator (leaf bind + anchor resolve + proofs + zip)

**Files:**
- Create: `web/src/workspaces/export/assembleExport.ts`
- Test: `web/src/workspaces/export/assembleExport.test.ts`
- Modify: `web/package.json` (add `fflate`)

**Interfaces:**
- Consumes: `useExportData` output, `leafHash`, `resolveProofState`, `getAnchors` (per-JE), `buildBundle`, `fflate.zipSync`.
- Produces:
  ```ts
  export interface ExportResult {
    ok: true; verified: boolean; filename: string; zip: Uint8Array; summary: BundleSummary;
  } | { ok: false; kind: 'imbalance'; debit: string; credit: string }
    | { ok: false; kind: 'empty' }
    | { ok: false; kind: 'error'; message: string };
  export async function assembleExport(args: {
    entityId: string; periodId: string; functionalCurrency: string; scale: number; generatedAt: string;
    journal: JournalDTO[]; events: EventDTO[]; anchors: AnchorDTO[];
    fetchProof: (idempotencyKey: string) => Promise<{ anchors: AnchorDTO[]; inclusionProof: InclusionProof | null }>;
  }): Promise<ExportResult>
  ```

- [ ] **Step 1: Add `fflate`**

Run: `cd web && npm install fflate` then confirm it appears in `dependencies`. Commit the lockfile change with Task 8's final commit.

- [ ] **Step 2: Write the failing tests** (orchestration paths)

Cover, with hand-built fixtures + a stub `fetchProof`:
- empty journal → `{ ok:false, kind:'empty' }` (nil return, not error);
- imbalanced journal → `{ ok:false, kind:'imbalance', debit, credit }` (catch `ImbalanceError`);
- unanchored (no anchor whose `periodId` matches OR no anchor `merkleRoot` matching a frozen snapshot) → `ok:true, verified:false`, filename ends `-UNVERIFIED-DRAFT.zip`;
- verified happy path (anchor for period present, `leafHash` recompute matches every row, every proof folds to `anchor.merkleRoot`, `anchor.leafCount === journal.length`) → `ok:true, verified:true`, filename `export-{entity}-{period}.zip`, `summary.proofsVerified === journal.length`;
- leaf mismatch (tamper one `je`) → `{ ok:false, kind:'error' }` (L2 fail-loud);
- proof fetch returns `null` for a JE on the verified path → `{ ok:false, kind:'error' }` (NOT a silent draft — transient/None proof on an anchored period is an error to surface).

- [ ] **Step 3: Run to confirm fail** — FAIL.

- [ ] **Step 4: Implement orchestration**

Logic order (all fail-loud):
1. If `journal.length === 0` → `{ ok:false, kind:'empty' }`.
2. Resolve date map: for each event, `normalized.eventTime` (string) ?? ISO from `normalized.timestampMs` ?? throw → caught as `kind:'error'`. Build `dateByEventId`.
3. L1 pre-check via buildBundle later (it throws ImbalanceError); wrap the whole assembly in try/catch and map `ImbalanceError` → `{ ok:false, kind:'imbalance' }`.
4. Resolve the period anchor: from `anchors`, keep those with `periodId === periodId` and `merkleRoot != null`; pick the highest `seq` (latest, non-superseded — superseded snapshots don't get anchors at the top seq). If none → draft (`binding = null`).
5. If an anchor is resolved (verified candidate): for each JE, `await leafHash(je)` and assert `=== row.leafHash` else throw (L2). Then `await fetchProof(idempotencyKey)`; if `inclusionProof == null` → throw (surface as error). `resolveProofState({ leafHash: row.leafHash, proof, anchors })` must be `verified-onchain` with `anchor.merkleRoot === resolvedAnchor.merkleRoot`; else throw. Collect proofs.
6. `binding = { anchor: {merkleRoot, snapshotId, digest, explorerUrl, leafCount}, proofs }`.
7. `built = await buildBundle({...})`.
8. `zip = zipSync(Object.fromEntries(built.files.map(f => [f.name, new TextEncoder().encode(f.content)])))`.
9. filename per verified flag. Return `{ ok:true, verified, filename, zip, summary: built.summary }`.

- [ ] **Step 5: Run to confirm pass** — PASS.

- [ ] **Step 6: Commit**
```bash
git add web/src/workspaces/export/assembleExport.ts web/src/workspaces/export/assembleExport.test.ts web/package.json web/package-lock.json
git commit -m "feat(export): async orchestrator — leaf-bind, anchor resolve, proof verify, zip"
```

---

## Task 9: `ExportWorkspace.tsx` + `export.css` — landing UI

**Files:**
- Create: `web/src/workspaces/export/ExportWorkspace.tsx`
- Create: `web/src/workspaces/export/export.css`
- Test: `web/src/workspaces/export/ExportWorkspace.test.tsx`

**Interfaces:**
- Consumes: `useExportData`, `assembleExport`, the entity/period from app context (mirror how `CloseCockpit`/`AuditWorkspace` read current entity + period — read those files first).
- Produces: the mounted workspace component (default export or named, matching sibling workspaces).

- [ ] **Step 1: Read sibling workspaces for context + period source**

Read `web/src/workspaces/close/` landing (how it gets entityId + periodId, how it renders `.period-ribbon` / `.light-card`, how the status chip + austere/aqua classes are used) and `web/src/components/chrome/EmptyState.tsx`. Reuse those patterns; do not invent new context plumbing.

- [ ] **Step 2: Write the failing tests** (behavior, not pixels)

Cover:
- verified state → renders the austere status card with the merkleRoot (full, not truncated) + an explorer `.aqua-link` + a self-verification summary line showing `Debits = Credits` with both totals + `bundledJeCount = anchoredLeafCount`; download button enabled.
- draft state (unanchored) → renders the dashed-cream "NOT TAMPER-EVIDENT" card + a DRAFT marker (icon+label, not color-only); filename preview shows `-UNVERIFIED-DRAFT.zip`.
- imbalance error → renders the `.light--red` "Cannot export — books do not balance" card showing debit vs credit + delta; download disabled.
- empty period → renders the mascot empty state ("nothing to export"), not an error.
- entity switch → does not show the previous entity's status (render-gate; use the deferred-mock harness).

- [ ] **Step 3: Run to confirm fail** — FAIL.

- [ ] **Step 4: Implement the component + styles**

- Layout (single column, 1200px well, left-aligned): H1 "Export" + one-line purpose + entity subhead → period selector (styled control, not bare `<select>`) → **status card (visual anchor)** → **self-verification summary** (inside/under the card) → download CTA (`.btn-primary` brass pill) with filename preview beside it.
- Status card variants per §7: verified = `.austere` navy + `.aqua-link` merkleRoot (`overflow-wrap:anywhere`, never truncate); draft = `.card` + dashed border + `.light--red` inset + mono "NOT TAMPER-EVIDENT" + unlock glyph.
- Self-verification summary (§8): mono tabular-nums lines with non-color ✓ glyphs (jeCount·legs, Debits=Credits with totals, merkleRoot match, leaves bound, proofs verified, completeness).
- Error state (§9): replace the card with `.light--red` imbalance card; disable CTA.
- Empty state: otter mascot + copy.
- Download: on click, call `assembleExport`, then trigger a browser download of the `Uint8Array` zip (`new Blob([zip], { type: 'application/zip' })` → object URL → `<a download={filename}>`); revoke the URL after.
- `export.css`: only what isn't already in `base.css`/`close.css`; reuse tokens, no new colors.

- [ ] **Step 5: Run to confirm pass** — PASS.

- [ ] **Step 6: Commit**
```bash
git add web/src/workspaces/export/ExportWorkspace.tsx web/src/workspaces/export/export.css web/src/workspaces/export/ExportWorkspace.test.tsx
git commit -m "feat(export): Export workspace landing — verified/draft cards, self-verify summary, download"
```

---

## Task 10: Wire `export` into the workspace shell

**Files:**
- Modify: `web/src/app/workspaces.ts:13` (`export` status `soon` → `ready`)
- Modify: the App workspace dispatch (find with `grep -rn "AuditWorkspace\|CloseCockpit" web/src/App.tsx web/src/app`)
- Test: extend the existing workspace-shell/registry test (find with `grep -rln "WORKSPACES\|isWorkspaceId" web/src`)

- [ ] **Step 1: Write the failing test** — assert selecting the `export` workspace mounts `ExportWorkspace` (and that `export` is `ready` in the registry, no longer rendering the generic `EmptyState`).

- [ ] **Step 2: Run to confirm fail** — FAIL.

- [ ] **Step 3: Flip status + add dispatch case**

In `web/src/app/workspaces.ts` change the `export` row `status: 'soon'` → `status: 'ready'`. In the App dispatch, add the `case 'export': return <ExportWorkspace />;` (match the exact pattern used for `audit`/`close`).

- [ ] **Step 4: Run to confirm pass** — PASS.

- [ ] **Step 5: Full suite + build gate**

Run: `cd web && npm run test` → all green. Run: `cd web && npm run build` → exit 0 (catches the vite-config tsc that `tsc --noEmit` misses, per the 2026-06-22 lesson).

- [ ] **Step 6: Commit**
```bash
git add web/src/app/workspaces.ts web/src/App.tsx web/src/app
git commit -m "feat(export): wire export workspace into shell (soon -> ready)"
```

---

## Task 11: Monkey testing + token/CSV audit

**Files:**
- Create: `web/src/workspaces/export/monkey.export.test.ts`
- Possibly modify any lib that a monkey case breaks.

- [ ] **Step 1: Write monkey tests** (per `.claude/rules/test.md` — try to break it)

Cover, end-to-end through `assembleExport`/`buildBundle` where possible:
- single-legged JE (imbalance) → imbalance result;
- negative `amountMinor` → throws (non-negative invariant);
- `account`/`leg` containing `,`, `"`, `\n`, and `=cmd`/`+`/`-`/`@` → CSV escaped + injection-guarded (parse the emitted `journal.csv` back and assert no unescaped break);
- unanchored period → draft, four watermarks present (filename, manifest.verified=false, manifest.anchor=null, VERIFY.md warning text);
- anchored but one JE's `je` tampered → leaf mismatch → error (L2 catches);
- `anchor.leafCount` != journal length → completeness fails (error, no verified bundle);
- proof `null` on anchored period → error (not silent draft);
- superseded/duplicate anchors for the period → highest-seq picked, no stale root;
- large journal (e.g. 500 synthetic balanced JEs) → completes, N proof fetches counted, no truncation, zip non-empty.

- [ ] **Step 2: Run; fix any real breakage** — `cd web && npm run test -- monkey.export`. If a case reveals a bug, fix the lib (not the test) and re-run.

- [ ] **Step 3: CSV/token audit**

Grep the new components for `var(--x)` and diff against defined tokens (per the 2026-06-22 token-alias lesson): `grep -roh "var(--[a-z0-9-]*)" web/src/workspaces/export | sort -u` and confirm each is defined in `web/src/styles/`. Fix any undefined token (alias in tokens.css, don't rename per-file).

- [ ] **Step 4: Full gate + commit**

Run: `cd web && npm run test` (all green) + `cd web && npm run build` (exit 0) + `cd services/api && npm test` (Task 1 still green).
```bash
git add web/src/workspaces/export/monkey.export.test.ts
git commit -m "test(export): monkey testing — injection, tamper, completeness, draft watermarks, scale"
```

---

## Self-Review (run before handing off to execution)

**Spec coverage check (spec → task):**
- §2/§3 additive backend field → Task 1. §5 file set + manifest + completeness → Task 6. §5.A date join + columns → Task 6/8. §6.L1 invariants → Task 3. §6.L2 leaf binding + parity → Task 2/8. §6.L3 proof + period→anchor + completeness → Task 8. §7 verified/draft cards → Task 9. §8 self-verify summary → Task 6 (data) + Task 9 (render). §9 error/empty/no-truncate → Task 8/9/11. §10/§11 decisions/deferred → encoded as invariants/tests, no new task. §12 testing → every task + Task 11. §13 DoD → Task 10/11 gates + dual-review (post-implementation, dev-rules).
- Quantity recon (accountant I4) → Task 4. reversalOf/priceRef/fxRef columns (I6/I7) → Task 6 columns. Book header (I1) → Task 5/6.

**Open items the implementer must resolve in-task (flagged, not placeholders):**
- The exact `normalized` date field name (`eventTime` vs deriving from `timestampMs`) — Task 8 Step 4 specifies the precedence + fail-loud; confirm against `services/api/src/fixtures/*.events.json` while implementing.
- `functionalCurrency` + `scale` source: read from the policy set / entity config the same way the rules-engine does (`ResolvedPolicySet.functionalCurrency`); Task 9 must thread the real value, not a hardcoded `USD`/`2`. Confirm where the web already knows the entity's functional currency (grep; if it doesn't, surface it — a wrong scale corrupts every amount).

**Post-implementation (NOT a task — dev-rules):** run the mandatory dual-review (`/dual-review`): codex round 1 + project-rules round 2. The evidence bundle is core financial/audit logic → external review is mandatory. Expect codex to probe L2/L3 fail-closed paths, the completeness check, and CSV injection.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-24-export-workspace.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks (two-stage), fast iteration. Per project rules, frontend tasks get `sui-frontend` + generic reviewer; the backend Task 1 (non-Move TS) gets the generic reviewer.

**2. Inline Execution** — execute tasks in this session via executing-plans, batch with checkpoints.

Which approach?
