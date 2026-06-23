# Audit Workspace (A-2 Event 並列下鑽) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only forensic walkthrough workspace (fills the `'audit'` 🔍 slot) where an auditor drills one event through raw→AI→JE→on-chain, with multi-select Compare for control-consistency.

**Architecture:** Pure frontend joins of existing read endpoints (`useEvents`/`useJournal`/`useAnchors`) plus ONE enriched backend field (`AnchorDTO.merkleRoot`). Inclusion proofs are **recomputed in the browser** (WebCrypto SHA-256), never trusted as a backend boolean. List/detail skeleton mirrors `ExceptionsWorkspace`; the right pane has two modes (Lineage / Compare) derived purely from selection state.

**Tech Stack:** React 18 + TypeScript, @tanstack/react-query v5, Vite, Vitest + @testing-library/react + jsdom. Backend: Fastify + better-sqlite3. No new dependencies (SHA-256 via built-in `crypto.subtle`).

**Spec:** `docs/superpowers/specs/2026-06-23-audit-drilldown-design.md`

## Global Constraints

- **No new npm dependencies.** Browser SHA-256 uses built-in `crypto.subtle.digest`.
- **DATA zone (spec §8.4) — every new Lineage/Compare file carries** `// DATA ZONE (spec §8.4) — NEVER import Mascot here.` at the top. Mascot allowed ONLY in `EmptyState` (chrome).
- **CSS tokens:** use the `--s-N` / `--r-*` / `--ink` / `--ink-soft` / `--paper` / `--paper-card` / `--paper-line` / `--brass` / `--brass-fill` / `--aqua` / `--aqua-bright` / `--debit` / `--credit` / `--warn` / `--austere-*` / `--navy-deep` token names already used by the data components. Never introduce a `--diff` token.
- **Evidence principle (spec §1.1):** anything shown as audit evidence is client-recomputable or explicitly labeled a backend assertion. No green check sourced from a backend boolean.
- **amountMinor is a BigInt string** — never parse to float; sum with `BigInt`.
- **Read-only:** the workspace imports ONLY `useEvents` / `useJournal` / `useAnchors`. Never import `usePrepareAnchor` / `useConfirmAnchor` / `useSnapshot` / `useDisposition`.
- **Compare cap = 4**, made legible (no silent truncation — Rule 12).
- **Diff / balance / proof states use non-color dual-axis encoding** (glyph/label + color), never color alone (a11y).
- **Tests verify intent (Rule 9)** + **Monkey Testing mandatory** (test.md): unit + integration + extreme/破壞測試.
- **Every backend change** runs `npm test` in `services/api`; every web change runs `npm test` + `npm run build` in `web/` (build catches errors `tsc --noEmit` misses).

---

### Task 1: Backend — enrich `AnchorDTO` with `merkleRoot`

The single backend change. `anchor.snapshotId → snapshot.merkleRoot` is the only honest binding for proof→anchor (spec §2.2/C-1). No new endpoint, table, or migration; `getSnapshot` is already imported in `routes.ts`.

**Files:**
- Modify: `services/api/src/http/routes.ts:384-401` (the `GET /entities/:id/anchors` map)
- Test: `services/api/test/routes.anchors.test.ts` (create, or add to existing anchors test if present)

**Interfaces:**
- Produces: `GET /entities/:id/anchors` anchors[] gain `merkleRoot: string | null` (null when the snapshot row is missing — fail-soft, never throws).

- [ ] **Step 1: Write the failing test**

Create `services/api/test/routes.anchors.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, seedEntity, seedSnapshot, seedAnchor } from './helpers.js';

describe('GET /anchors merkleRoot enrichment', () => {
  it('joins each anchor to its snapshot merkleRoot', async () => {
    const { app, db } = await buildTestApp();
    seedEntity(db, 'acme:pilot-001');
    seedSnapshot(db, { id: 'snap-1', entityId: 'acme:pilot-001', merkleRoot: 'abcd1234' });
    seedAnchor(db, { id: 'anc-1', entityId: 'acme:pilot-001', snapshotId: 'snap-1', seq: 1 });

    const res = await app.inject({ method: 'GET', url: '/entities/acme%3Apilot-001/anchors' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.anchors[0].merkleRoot).toBe('abcd1234');
  });

  it('returns merkleRoot null when the snapshot row is gone (fail-soft, no throw)', async () => {
    const { app, db } = await buildTestApp();
    seedEntity(db, 'acme:pilot-001');
    seedAnchor(db, { id: 'anc-x', entityId: 'acme:pilot-001', snapshotId: 'snap-missing', seq: 1 });

    const res = await app.inject({ method: 'GET', url: '/entities/acme%3Apilot-001/anchors' });
    expect(res.statusCode).toBe(200);
    expect(res.json().anchors[0].merkleRoot).toBeNull();
  });
});
```

> If `test/helpers.js` lacks `seedSnapshot`/`seedAnchor`, add them mirroring the existing seed helpers (insert via `insertSnapshot` / `insertAnchor` with sensible defaults: `manifestJson:'{}'`, `manifestHash:'h'`, `leafCount:1`, `supersedesSeq:null`, `status:'ANCHORED'`; anchor `link:'L'`, `digest:'D'`, `explorerUrl:'#'`, `anchoredAt:'2026-06-23T00:00:00Z'`). Read `services/api/test/helpers.*` first to match its style.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/routes.anchors.test.ts`
Expected: FAIL — `body.anchors[0].merkleRoot` is `undefined` (field absent).

- [ ] **Step 3: Implement the join**

In `services/api/src/http/routes.ts`, change the `listAnchors(...).map(...)` inside `GET /entities/:id/anchors` (currently lines 386-389) to add `merkleRoot`:

```ts
    const anchors = listAnchors(db, req.params.id).map((r) => ({
      id: r.id, snapshotId: r.snapshotId, seq: r.seq, link: r.link,
      digest: r.digest, explorerUrl: r.explorerUrl, anchoredAt: r.anchoredAt,
      merkleRoot: getSnapshot(db, r.snapshotId)?.merkleRoot ?? null,
    }));
```

(`getSnapshot` is already imported at `routes.ts:14`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && npx vitest run test/routes.anchors.test.ts`
Expected: PASS (both cases).
Then full suite: `cd services/api && npm test` — Expected: all green (no regression).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/http/routes.ts services/api/test/routes.anchors.test.ts services/api/test/helpers.*
git commit -m "feat(api): enrich AnchorDTO with merkleRoot (snapshot join) for client proof verification"
```

---

### Task 2: Web — `AnchorDTO.merkleRoot` type + browser inclusion-proof verifier

The evidence spine (spec §6). A pure async util that recomputes the Merkle root in the browser from `leafHash` + sibling path (exactly mirroring the node-side fold: leaf prefix `0x00`, node prefix `0x01`), then resolves the three honest proof states.

**Files:**
- Modify: `web/src/api/types.ts:66-74` (add `merkleRoot` to `AnchorDTO`)
- Create: `web/src/lib/proofVerify.ts`
- Test: `web/src/lib/proofVerify.test.ts`

**Interfaces:**
- Consumes: `InclusionProof` (`{ idempotencyKey, leafIndex, siblings: {hash,position:'L'|'R'}[], merkleRoot }`), `AnchorDTO` (now with `merkleRoot: string | null`).
- Produces:
  - `recomputeRoot(leafHashHex: string, siblings: {hash:string;position:'L'|'R'}[]): Promise<string>`
  - `type ProofState = { kind: 'verified-onchain'; anchor: AnchorDTO } | { kind: 'verified-pending' } | { kind: 'not-in-journal' } | { kind: 'mismatch'; recomputed: string; claimed: string }`
  - `resolveProofState(args: { leafHash: string; proof: InclusionProof | null; anchors: AnchorDTO[] }): Promise<ProofState>`

- [ ] **Step 1: Add `merkleRoot` to `AnchorDTO`**

In `web/src/api/types.ts`, the `AnchorDTO` interface (lines 66-74) gains one field:

```ts
export interface AnchorDTO {
  id: string;
  snapshotId: string;
  seq: number;
  link: string;
  digest: string;
  explorerUrl: string;
  anchoredAt: string;
  merkleRoot: string | null; // joined from the anchored snapshot (Task 1)
}
```

- [ ] **Step 2: Write the failing test**

Create `web/src/lib/proofVerify.test.ts`. We build a tiny 2-leaf tree by hand using the SAME hashing the util will use, so the test is self-consistent and would fail if the fold order is wrong (Rule 9 — encodes "the browser fold must match the on-chain fold").

```ts
import { describe, it, expect } from 'vitest';
import { recomputeRoot, resolveProofState } from './proofVerify';
import type { AnchorDTO, InclusionProof } from '../api/types';

// SHA-256 hex helper for building expected fixtures (mirrors node merkle.ts: leaf=0x00||bytes, node=0x01||L||R)
async function sha256hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const anchor = (over: Partial<AnchorDTO>): AnchorDTO => ({
  id: 'a', snapshotId: 's', seq: 1, link: 'L', digest: 'D', explorerUrl: '#',
  anchoredAt: 't', merkleRoot: null, ...over,
});

describe('recomputeRoot', () => {
  it('folds leafHash + one R-sibling exactly like the node-side tree', async () => {
    // two leaves A (our leaf) and B (sibling on the right)
    const leafA = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('A')));
    const leafB = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('B')));
    const expectedRoot = await sha256hex(concat(Uint8Array.of(0x01), hexToBytes(leafA), hexToBytes(leafB)));

    const root = await recomputeRoot(leafA, [{ hash: leafB, position: 'R' }]);
    expect(root).toBe(expectedRoot);
  });

  it('respects L-position (sibling on the left)', async () => {
    const leafA = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('A')));
    const leafB = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('B')));
    // leaf A is the RIGHT child → sibling B is on the LEFT
    const expectedRoot = await sha256hex(concat(Uint8Array.of(0x01), hexToBytes(leafB), hexToBytes(leafA)));
    const root = await recomputeRoot(leafA, [{ hash: leafB, position: 'L' }]);
    expect(root).toBe(expectedRoot);
  });
});

describe('resolveProofState', () => {
  const proofFor = async (): Promise<{ proof: InclusionProof; leafHash: string; root: string }> => {
    const leafHash = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('A')));
    const sib = await sha256hex(concat(Uint8Array.of(0x00), new TextEncoder().encode('B')));
    const root = await recomputeRoot(leafHash, [{ hash: sib, position: 'R' }]);
    return { leafHash, root, proof: { idempotencyKey: 'k', leafIndex: 0, siblings: [{ hash: sib, position: 'R' }], merkleRoot: root } };
  };

  it('not-in-journal when proof is null', async () => {
    const s = await resolveProofState({ leafHash: 'x', proof: null, anchors: [] });
    expect(s.kind).toBe('not-in-journal');
  });

  it('verified-onchain when recomputed root matches an anchor merkleRoot', async () => {
    const { leafHash, root, proof } = await proofFor();
    const s = await resolveProofState({ leafHash, proof, anchors: [anchor({ merkleRoot: root, seq: 7 })] });
    expect(s.kind).toBe('verified-onchain');
    if (s.kind === 'verified-onchain') expect(s.anchor.seq).toBe(7);
  });

  it('verified-pending when proof verifies but no anchor carries that root', async () => {
    const { leafHash, proof } = await proofFor();
    const s = await resolveProofState({ leafHash, proof, anchors: [anchor({ merkleRoot: 'deadbeef' })] });
    expect(s.kind).toBe('verified-pending');
  });

  it('mismatch when the proof does NOT recompute to its claimed root (tamper)', async () => {
    const { leafHash, proof } = await proofFor();
    const tampered: InclusionProof = { ...proof, merkleRoot: 'ff'.repeat(32) };
    const s = await resolveProofState({ leafHash, proof: tampered, anchors: [] });
    expect(s.kind).toBe('mismatch');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/proofVerify.test.ts`
Expected: FAIL — module `./proofVerify` not found.

- [ ] **Step 4: Implement the verifier**

Create `web/src/lib/proofVerify.ts`:

```ts
// DATA ZONE (spec §8.4) — NEVER import Mascot here.
// Browser-side inclusion-proof verification (spec §6). We recompute the Merkle
// root from the JE's leafHash + sibling path using WebCrypto SHA-256, mirroring
// the node-side fold in services/rules-engine/src/core/merkle.ts:
//   leaf  = SHA-256(0x00 || leafBytes)   ← already given to us as JournalDTO.leafHash
//   node  = SHA-256(0x01 || left || right)
// We start from leafHash (the leaf digest) and fold siblings. This is genuine
// client recomputation of the on-chain-anchored root — NOT a backend boolean.
import type { AnchorDTO, InclusionProof } from '../api/types';

const LEAF_NODE_PREFIX = 0x01;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
async function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(Uint8Array.of(LEAF_NODE_PREFIX), left, right));
}

/** Fold leafHash up through the sibling path to the Merkle root (hex). */
export async function recomputeRoot(
  leafHashHex: string,
  siblings: { hash: string; position: 'L' | 'R' }[],
): Promise<string> {
  let acc = hexToBytes(leafHashHex);
  for (const sib of siblings) {
    const sibBytes = hexToBytes(sib.hash);
    acc = sib.position === 'L' ? await nodeHash(sibBytes, acc) : await nodeHash(acc, sibBytes);
  }
  return bytesToHex(acc);
}

export type ProofState =
  | { kind: 'verified-onchain'; anchor: AnchorDTO }
  | { kind: 'verified-pending' }
  | { kind: 'not-in-journal' }
  | { kind: 'mismatch'; recomputed: string; claimed: string };

/**
 * Three honest states (+ mismatch). `proof === null` means the idempotencyKey is
 * not in the live journal (e.g. the JE was reversed) — distinct from pending.
 */
export async function resolveProofState(args: {
  leafHash: string;
  proof: InclusionProof | null;
  anchors: AnchorDTO[];
}): Promise<ProofState> {
  const { leafHash, proof, anchors } = args;
  if (!proof) return { kind: 'not-in-journal' };

  const recomputed = await recomputeRoot(leafHash, proof.siblings);
  if (recomputed !== proof.merkleRoot) {
    return { kind: 'mismatch', recomputed, claimed: proof.merkleRoot };
  }
  const match = anchors.find((a) => a.merkleRoot !== null && a.merkleRoot === proof.merkleRoot);
  return match ? { kind: 'verified-onchain', anchor: match } : { kind: 'verified-pending' };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/proofVerify.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/api/types.ts web/src/lib/proofVerify.ts web/src/lib/proofVerify.test.ts
git commit -m "feat(web): browser inclusion-proof verifier + AnchorDTO.merkleRoot (evidence spine §6)"
```

---

### Task 3: `ConfidenceBar` compact variant

`ConfidenceBar` hard-codes `minWidth:320` (root) + `minWidth:92` (readout), which overflows the ~280px AI lineage column (spec §C-2). Add an opt-in `compact` prop that drops the floors and stacks the readout below the bar.

**Files:**
- Modify: `web/src/components/data/ConfidenceBar.tsx`
- Test: `web/src/components/data/ConfidenceBar.test.tsx` (add case)

**Interfaces:**
- Produces: `ConfidenceBar` gains optional `compact?: boolean` (default `false`). Existing call sites unchanged.

- [ ] **Step 1: Write the failing test**

Add to `web/src/components/data/ConfidenceBar.test.tsx`:

```ts
it('compact variant drops the 320px floor so it fits a narrow column', () => {
  const { getByTestId } = render(<ConfidenceBar confidence={0.9} compact />);
  const root = getByTestId('confidence-bar');
  expect(root.style.minWidth).toBe('0px');
});
```

(If the file imports differ, match the existing test header in that file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/data/ConfidenceBar.test.tsx`
Expected: FAIL — `minWidth` is `'320px'` (prop ignored).

- [ ] **Step 3: Implement compact**

In `web/src/components/data/ConfidenceBar.tsx`, extend the signature and apply it:

```ts
export function ConfidenceBar({
  confidence,
  threshold = CLASSIFY_THRESHOLD,
  compact = false,
}: {
  confidence: number | null;
  threshold?: number;
  compact?: boolean;
}) {
```

Then change the root wrapper's `minWidth: 320` (line ~49) to `minWidth: compact ? 0 : 320`, and the readout `<span>`'s `minWidth: 92` (line ~72) to `minWidth: compact ? 0 : 92`. Leave all other styling/animation intact.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/data/ConfidenceBar.test.tsx`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/data/ConfidenceBar.tsx web/src/components/data/ConfidenceBar.test.tsx
git commit -m "feat(web): ConfidenceBar compact variant for narrow lineage column"
```

---

### Task 4: `AuditWorkspace` + `EventList` (selection state, filters, multi-select)

The shell of the workspace: list rail + mode-deriving selection state. Lineage/Compare panes are stubbed here and filled in Tasks 5-6.

**Files:**
- Create: `web/src/workspaces/AuditWorkspace.tsx`
- Create: `web/src/components/data/EventList.tsx`
- Create: `web/src/lib/auditSelection.ts` (pure mode-derivation — code, not model, Rule 5)
- Test: `web/src/lib/auditSelection.test.ts`, `web/src/components/data/EventList.test.tsx`

**Interfaces:**
- Consumes: `useEvents(entityId)` → `EventDTO[]`; `EventDTO` (`{id, status, ai, final, routing, normalized}`).
- Produces:
  - `auditSelection.ts`: `type AuditMode = 'pick' | 'lineage' | 'compare'`; `deriveMode(sel: { selectedId: string | null; compareIds: string[] }): AuditMode`
  - `EventList` props: `{ events: EventDTO[]; selectedId: string | null; compareIds: string[]; onSelect(id: string): void; onToggleCompare(id: string): void; statusFilter: EventStatus | 'ALL'; onStatusFilter(s: EventStatus | 'ALL'): void }`

- [ ] **Step 1: Write the failing test (mode derivation)**

Create `web/src/lib/auditSelection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveMode } from './auditSelection';

describe('deriveMode', () => {
  it('compare when 2+ events are checked', () => {
    expect(deriveMode({ selectedId: 'a', compareIds: ['a', 'b'] })).toBe('compare');
  });
  it('lineage when exactly one selected and <2 compared', () => {
    expect(deriveMode({ selectedId: 'a', compareIds: [] })).toBe('lineage');
    expect(deriveMode({ selectedId: 'a', compareIds: ['a'] })).toBe('lineage');
  });
  it('pick when nothing usable selected', () => {
    expect(deriveMode({ selectedId: null, compareIds: [] })).toBe('pick');
    expect(deriveMode({ selectedId: null, compareIds: ['a'] })).toBe('lineage'); // single check still drills
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd web && npx vitest run src/lib/auditSelection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `auditSelection.ts`**

```ts
// Pure selection→mode derivation (Rule 5: deterministic, code not model).
export type AuditMode = 'pick' | 'lineage' | 'compare';

export function deriveMode(sel: { selectedId: string | null; compareIds: string[] }): AuditMode {
  if (sel.compareIds.length >= 2) return 'compare';
  if (sel.compareIds.length === 1) return 'lineage';
  if (sel.selectedId) return 'lineage';
  return 'pick';
}

/** The single event a lineage view should render, given the selection. */
export function lineageTarget(sel: { selectedId: string | null; compareIds: string[] }): string | null {
  if (sel.compareIds.length === 1) return sel.compareIds[0]!;
  return sel.selectedId;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/lib/auditSelection.test.ts` — Expected: PASS.

- [ ] **Step 5: Write the failing test (EventList)**

Create `web/src/components/data/EventList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventList } from './EventList';
import type { EventDTO } from '../../api/types';

const ev = (over: Partial<EventDTO>): EventDTO => ({
  id: 'evt_1', entityId: 'e', status: 'POSTED', normalized: {}, ai: null, final: null, routing: null, ...over,
});

const base = {
  selectedId: null, compareIds: [] as string[],
  onSelect: () => {}, onToggleCompare: () => {},
  statusFilter: 'ALL' as const, onStatusFilter: () => {},
};

it('renders one row per event with its id', () => {
  render(<EventList {...base} events={[ev({ id: 'evt_A' }), ev({ id: 'evt_B' })]} />);
  expect(screen.getByText('evt_A')).toBeInTheDocument();
  expect(screen.getByText('evt_B')).toBeInTheDocument();
});

it('row body click selects for lineage; checkbox toggles compare (distinct targets)', async () => {
  const onSelect = vi.fn();
  const onToggleCompare = vi.fn();
  render(<EventList {...base} events={[ev({ id: 'evt_A' })]} onSelect={onSelect} onToggleCompare={onToggleCompare} />);
  await userEvent.click(screen.getByRole('button', { name: /evt_A/ }));
  expect(onSelect).toHaveBeenCalledWith('evt_A');
  await userEvent.click(screen.getByRole('checkbox', { name: /compare evt_A/i }));
  expect(onToggleCompare).toHaveBeenCalledWith('evt_A');
});

it('status filter narrows the visible rows', () => {
  render(
    <EventList {...base} statusFilter="POSTED"
      events={[ev({ id: 'evt_posted', status: 'POSTED' }), ev({ id: 'evt_review', status: 'NEEDS_REVIEW' })]} />,
  );
  expect(screen.getByText('evt_posted')).toBeInTheDocument();
  expect(screen.queryByText('evt_review')).not.toBeInTheDocument();
});

it('marks an unclassified event (ai null) with a pending tag', () => {
  render(<EventList {...base} events={[ev({ id: 'evt_p', status: 'INGESTED', ai: null })]} />);
  expect(screen.getByText(/pending/i)).toBeInTheDocument();
});
```

- [ ] **Step 6: Run to verify fail**

Run: `cd web && npx vitest run src/components/data/EventList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `EventList.tsx`**

```tsx
// DATA ZONE (spec §8.4) — NEVER import Mascot here.
import type { EventDTO, EventStatus } from '../../api/types';

const STATUS_GLYPH: Record<string, string> = {
  INGESTED: '◌', AUTO: '⑂', NEEDS_REVIEW: '⑂', APPROVED: '✓', POSTED: '⛓',
};

// brass rail = "this event is in the compare basket" (repurposed blocker idiom).
function Row({
  e, selected, inCompare, onSelect, onToggleCompare,
}: {
  e: EventDTO; selected: boolean; inCompare: boolean;
  onSelect(id: string): void; onToggleCompare(id: string): void;
}) {
  const pending = e.ai === null; // not yet classified
  const type = e.final?.eventType ?? e.ai?.eventType ?? '—';
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: 'auto auto 1fr auto', gap: 'var(--s-3)',
        alignItems: 'center', padding: 'var(--s-3)',
        borderLeft: inCompare ? '3px solid var(--brass)' : '3px solid transparent',
        borderBottom: '1px solid var(--paper-line)',
        background: selected ? 'var(--paper-card)' : 'transparent',
      }}
    >
      <input
        type="checkbox"
        aria-label={`Compare ${e.id}`}
        checked={inCompare}
        onChange={() => onToggleCompare(e.id)}
        style={{ cursor: 'pointer' }}
      />
      <span aria-hidden style={{ fontSize: 16, color: pending ? 'var(--ink-soft)' : 'var(--ink)' }}>
        {STATUS_GLYPH[e.status] ?? '◌'}
      </span>
      <button
        onClick={() => onSelect(e.id)}
        aria-current={selected ? 'true' : undefined}
        style={{ display: 'block', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
      >
        <span style={{ fontSize: 12, fontWeight: selected ? 700 : 500, color: 'var(--ink)' }}>{type}</span>
        <span className="mono" style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}>{e.id}</span>
      </button>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
        {pending ? 'pending' : e.status.toLowerCase()}
      </span>
    </div>
  );
}

const FILTERS: (EventStatus | 'ALL')[] = ['ALL', 'INGESTED', 'NEEDS_REVIEW', 'AUTO', 'APPROVED', 'POSTED'];

export function EventList({
  events, selectedId, compareIds, onSelect, onToggleCompare, statusFilter, onStatusFilter,
}: {
  events: EventDTO[];
  selectedId: string | null;
  compareIds: string[];
  onSelect(id: string): void;
  onToggleCompare(id: string): void;
  statusFilter: EventStatus | 'ALL';
  onStatusFilter(s: EventStatus | 'ALL'): void;
}) {
  const shown = statusFilter === 'ALL' ? events : events.filter((e) => e.status === statusFilter);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)', padding: 'var(--s-3)' }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            aria-pressed={statusFilter === f}
            onClick={() => onStatusFilter(f)}
            style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-pill)',
              border: '1px solid var(--paper-line)', cursor: 'pointer',
              background: statusFilter === f ? 'var(--brass-fill)' : 'transparent',
              color: 'var(--ink)', fontWeight: statusFilter === f ? 600 : 400,
            }}
          >
            {f === 'ALL' ? 'All' : f.toLowerCase()}
          </button>
        ))}
      </div>
      {shown.map((e) => (
        <Row
          key={e.id} e={e}
          selected={e.id === selectedId}
          inCompare={compareIds.includes(e.id)}
          onSelect={onSelect} onToggleCompare={onToggleCompare}
        />
      ))}
    </div>
  );
}
```

> Note: `--r-pill` is defined in tokens.css (added in the UI-polish work). If a typecheck/build flags it missing, use `999px` literally.

- [ ] **Step 8: Run to verify pass**

Run: `cd web && npx vitest run src/components/data/EventList.test.tsx` — Expected: PASS.

- [ ] **Step 9: Implement `AuditWorkspace.tsx` (panes stubbed)**

```tsx
// DATA ZONE (spec §8.4) — NEVER import Mascot here (right pane is all data surfaces).
import { useState } from 'react';
import { useEntityCtx } from '../app/EntityContext';
import { useEvents, useJournal } from '../api/hooks';
import { EventList } from '../components/data/EventList';
import { EmptyState } from '../components/chrome/EmptyState';
import { EventLineage } from '../components/data/EventLineage';
import { EventCompare } from '../components/data/EventCompare';
import { deriveMode, lineageTarget } from '../lib/auditSelection';
import type { EventStatus } from '../api/types';

export function AuditWorkspace() {
  const { entity } = useEntityCtx();
  const { data: events } = useEvents(entity?.id);
  const { data: journal } = useJournal(entity?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'ALL'>('ALL');

  const list = events ?? [];
  if (list.length === 0) return <EmptyState variant="clear-seas" />;

  const mode = deriveMode({ selectedId, compareIds });
  const toggleCompare = (id: string) =>
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const targetId = lineageTarget({ selectedId, compareIds });
  const target = list.find((e) => e.id === targetId) ?? null;
  const hasSel = mode !== 'pick';

  return (
    <div
      className={`exceptions-layout${hasSel ? ' has-selection' : ''}`}
      style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'flex-start' }}
    >
      <div className="card exceptions-list-pane" style={{ flex: '0 0 320px', padding: 0, overflow: 'hidden' }}>
        <EventList
          events={list}
          selectedId={selectedId}
          compareIds={compareIds}
          onSelect={(id) => { setSelectedId(id); setCompareIds([]); }}
          onToggleCompare={toggleCompare}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
        />
      </div>
      <div className="exceptions-detail-pane" style={{ flex: '1 1 360px', minWidth: 0 }}>
        {hasSel && (
          <button
            className="exceptions-back-btn"
            onClick={() => { setSelectedId(null); setCompareIds([]); }}
            style={{ marginBottom: 'var(--s-3)', background: 'none', border: 'none', color: 'var(--brass)', fontWeight: 600, fontSize: 14, cursor: 'pointer', padding: '4px 0' }}
          >
            ‹ Events · {list.length}
          </button>
        )}
        {mode === 'pick' && <EmptyState variant="pick-one" />}
        {mode === 'lineage' && target && (
          <EventLineage event={target} entityId={entity!.id} journal={journal ?? []} />
        )}
        {mode === 'compare' && (
          <EventCompare
            events={list.filter((e) => compareIds.includes(e.id))}
            journal={journal ?? []}
          />
        )}
      </div>
    </div>
  );
}
```

> This will not typecheck until Tasks 5-6 create `EventLineage`/`EventCompare`. That is expected — commit happens after Step 10 only if the placeholder stubs exist. To keep this task independently green, create minimal stubs now:
>
> `web/src/components/data/EventLineage.tsx`:
> ```tsx
> // DATA ZONE (spec §8.4) — NEVER import Mascot here.
> import type { EventDTO, JournalDTO } from '../../api/types';
> export function EventLineage(_: { event: EventDTO; entityId: string; journal: JournalDTO[] }) {
>   return <div data-testid="lineage-stub" />;
> }
> ```
> `web/src/components/data/EventCompare.tsx`:
> ```tsx
> // DATA ZONE (spec §8.4) — NEVER import Mascot here.
> import type { EventDTO, JournalDTO } from '../../api/types';
> export function EventCompare(_: { events: EventDTO[]; journal: JournalDTO[] }) {
>   return <div data-testid="compare-stub" />;
> }
> ```

- [ ] **Step 10: Verify build + commit**

Run: `cd web && npm run build` — Expected: exit 0.
Run: `cd web && npx vitest run src/lib/auditSelection.test.ts src/components/data/EventList.test.tsx` — Expected: PASS.

```bash
git add web/src/workspaces/AuditWorkspace.tsx web/src/components/data/EventList.tsx web/src/components/data/EventLineage.tsx web/src/components/data/EventCompare.tsx web/src/lib/auditSelection.ts web/src/lib/auditSelection.test.ts web/src/components/data/EventList.test.tsx
git commit -m "feat(web): AuditWorkspace shell + EventList (filters, multi-select, pending) + mode derivation"
```

---

### Task 5: `EventLineage` — the 4-stage walkthrough

Replaces the stub. Reuses `JournalTable` / `HashChain` / `ConfidenceBar` (compact). Adds the balance footer (1.1), reversal/lineageHash (1.5/1.6), client proof verification (§6), pending stages (§9), and the deferred-pointer labels for 1.2/1.4.

**Files:**
- Modify (replace stub): `web/src/components/data/EventLineage.tsx`
- Create: `web/src/components/data/ProofBadge.tsx`
- Create: `web/src/lib/balance.ts`
- Test: `web/src/lib/balance.test.ts`, `web/src/components/data/EventLineage.test.tsx`

**Interfaces:**
- Consumes: `EventDTO`, `JournalDTO[]` (filter `j.eventId === event.id`), `useAnchors(entityId, idempotencyKey)`, `resolveProofState` (Task 2).
- Produces:
  - `balance.ts`: `sumByCurrency(lines): { functionalDebit: bigint; functionalCredit: bigint; delta: bigint; balanced: boolean }`
  - `ProofBadge` props: `{ leafHash: string; idempotencyKey: string; lineageHash: string; entityId: string }`

- [ ] **Step 1: Write the failing test (balance)**

Create `web/src/lib/balance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sumFunctional } from './balance';
import type { JournalLine } from '../api/types';

const line = (side: 'DEBIT' | 'CREDIT', amt: string): JournalLine => ({
  account: 'a', side, amountMinor: amt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'x',
});

describe('sumFunctional', () => {
  it('balances when debit equals credit (BigInt, no float)', () => {
    const r = sumFunctional([line('DEBIT', '31240'), line('CREDIT', '31240')]);
    expect(r.balanced).toBe(true);
    expect(r.delta).toBe(0n);
  });
  it('flags an out-of-balance entry with a nonzero delta', () => {
    const r = sumFunctional([line('DEBIT', '100'), line('CREDIT', '90')]);
    expect(r.balanced).toBe(false);
    expect(r.delta).toBe(10n);
  });
  it('does not lose precision on large minor units', () => {
    const big = '9007199254740993'; // > Number.MAX_SAFE_INTEGER
    const r = sumFunctional([line('DEBIT', big), line('CREDIT', big)]);
    expect(r.balanced).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `cd web && npx vitest run src/lib/balance.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `balance.ts`**

```ts
// BigInt arithmetic only — amountMinor is a minor-unit string, never a float.
import type { JournalLine } from '../api/types';

export interface BalanceResult {
  functionalDebit: bigint;
  functionalCredit: bigint;
  delta: bigint; // debit - credit (functional ccy)
  balanced: boolean;
}

export function sumFunctional(lines: JournalLine[]): BalanceResult {
  let d = 0n;
  let c = 0n;
  for (const l of lines) {
    const amt = BigInt(l.amountMinor);
    if (l.side === 'DEBIT') d += amt;
    else c += amt;
  }
  return { functionalDebit: d, functionalCredit: c, delta: d - c, balanced: d === c };
}

/** origCoinType subtotals — MEMO only (foreign legs need not net). */
export function origMemo(lines: JournalLine[]): Record<string, bigint> {
  const memo: Record<string, bigint> = {};
  for (const l of lines) {
    if (!l.origCoinType || !l.origQtyMinor) continue;
    const q = BigInt(l.origQtyMinor);
    memo[l.origCoinType] = (memo[l.origCoinType] ?? 0n) + (l.side === 'DEBIT' ? q : -q);
  }
  return memo;
}
```

- [ ] **Step 4: Run to verify pass** — `cd web && npx vitest run src/lib/balance.test.ts` → PASS.

- [ ] **Step 5: Implement `ProofBadge.tsx`** (client-verified, three-state)

```tsx
// DATA ZONE (spec §8.4) — NEVER import Mascot here. §6 client-side proof verification.
import { useEffect, useState } from 'react';
import { useAnchors } from '../../api/hooks';
import { resolveProofState, type ProofState } from '../../lib/proofVerify';

function shortHex(h: string) { return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h; }

export function ProofBadge({ leafHash, idempotencyKey, lineageHash, entityId }: {
  leafHash: string; idempotencyKey: string; lineageHash: string; entityId: string;
}) {
  const { data } = useAnchors(entityId, idempotencyKey);
  const [state, setState] = useState<ProofState | null>(null);

  useEffect(() => {
    let alive = true;
    if (!data) { setState(null); return; }
    resolveProofState({ leafHash, proof: data.inclusionProof, anchors: data.anchors })
      .then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, [data, leafHash]);

  return (
    <div className="mono" style={{ fontSize: 13, color: 'var(--austere-mono)', marginTop: 'var(--s-3)' }}>
      <div style={{ color: 'var(--austere-dim)' }}>lineageHash {shortHex(lineageHash)}</div>
      <div style={{ color: 'var(--austere-dim)' }}>leafHash {shortHex(leafHash)}</div>
      {state === null && <div style={{ color: 'var(--austere-dim)' }}>verifying proof in browser…</div>}
      {state?.kind === 'verified-onchain' && (
        <div style={{ color: 'var(--aqua-bright)' }}>
          ✓ proof recomputed in browser · matches on-chain root · anchor seq #{state.anchor.seq}
        </div>
      )}
      {state?.kind === 'verified-pending' && (
        <div style={{ color: 'var(--warn)' }}>✓ proof recomputed · ◌ not yet anchored on-chain</div>
      )}
      {state?.kind === 'not-in-journal' && (
        <div style={{ color: 'var(--austere-dim)' }}>— not in current journal (reversed or superseded)</div>
      )}
      {state?.kind === 'mismatch' && (
        <div style={{ color: 'var(--debit)' }}>✗ PROOF MISMATCH — recomputed root ≠ claimed root</div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write the failing test (EventLineage)**

Create `web/src/components/data/EventLineage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EventLineage } from './EventLineage';
import type { EventDTO, JournalDTO } from '../../api/types';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const event = (over: Partial<EventDTO> = {}): EventDTO => ({
  id: 'evt_A', entityId: 'e', status: 'POSTED', normalized: { txDigest: '0xabc' },
  ai: { eventType: 'TOKEN_SWAP', purpose: 'swap', counterparty: null, confidence: 0.92, reasoning: 'r' },
  final: null, routing: null, ...over,
});

const je = (over: Partial<JournalDTO> = {}): JournalDTO => ({
  id: 'je1', eventId: 'evt_A', idempotencyKey: 'k1', leafHash: 'aa',
  je: { idempotencyKey: 'k1', lineageHash: 'LIN123', reversalOf: null, lines: [
    { account: 'SUI', side: 'DEBIT', amountMinor: '312', origCoinType: null, origQtyMinor: null, priceRef: 'p1', fxRef: null, leg: 'in' },
    { account: 'USDC', side: 'CREDIT', amountMinor: '312', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'out' },
  ] }, ...over,
});

it('renders all four stage headers', () => {
  wrap(<EventLineage event={event()} entityId="e" journal={[je()]} />);
  expect(screen.getByText(/Raw event/i)).toBeInTheDocument();
  expect(screen.getByText(/Classification/i)).toBeInTheDocument();
  expect(screen.getByText(/Journal entry/i)).toBeInTheDocument();
  expect(screen.getByText(/On-chain/i)).toBeInTheDocument();
});

it('shows the balance footer Δ=0 for a balanced JE', () => {
  wrap(<EventLineage event={event()} entityId="e" journal={[je()]} />);
  expect(screen.getByText(/Δ 0/)).toBeInTheDocument();
});

it('surfaces lineageHash (1.6) in the chain stage', () => {
  wrap(<EventLineage event={event()} entityId="e" journal={[je()]} />);
  expect(screen.getByText(/LIN123/)).toBeInTheDocument();
});

it('labels priceRef/fxRef as unresolved pointers (1.4 deferred)', () => {
  wrap(<EventLineage event={event()} entityId="e" journal={[je()]} />);
  expect(screen.getByText(/p1/)).toBeInTheDocument();
  expect(screen.getAllByText(/unresolved pointer/i).length).toBeGreaterThan(0);
});

it('shows pending copy when the event is unclassified', () => {
  wrap(<EventLineage event={event({ ai: null, status: 'INGESTED' })} entityId="e" journal={[]} />);
  expect(screen.getByText(/awaiting classification/i)).toBeInTheDocument();
  expect(screen.getByText(/not yet posted/i)).toBeInTheDocument();
});

it('shows reversal badge when reversalOf is set (1.5)', () => {
  wrap(<EventLineage event={event()} entityId="e" journal={[je({ je: { ...je().je, reversalOf: 'k0' } })]} />);
  expect(screen.getByText(/reversal of/i)).toBeInTheDocument();
});
```

- [ ] **Step 7: Run to verify fail** — `cd web && npx vitest run src/components/data/EventLineage.test.tsx` → FAIL (stub renders nothing matching).

- [ ] **Step 8: Implement `EventLineage.tsx`** (replace the stub)

```tsx
// DATA ZONE (spec §8.4) — NEVER import Mascot here. The four-stage forensic walkthrough.
import type { EventDTO, JournalDTO, JournalLine } from '../../api/types';
import { ConfidenceBar } from './ConfidenceBar';
import { JournalTable } from './JournalTable';
import { ProofBadge } from './ProofBadge';
import { sumFunctional, origMemo } from '../../lib/balance';

const ARROW = '→'; // mirrors HashChain's mono arrow (rotates to ↓ via CSS on stacked layouts)

function StageCard({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="card audit-stage" style={{ flex: 1, minWidth: 0 }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{n}</div>
      <h4 style={{ margin: '2px 0 var(--s-3)' }}>{title}</h4>
      {children}
    </div>
  );
}

function Pending({ label }: { label: string }) {
  return <div className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)' }}>◌ {label}</div>;
}

function RefRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
      {label} <span style={{ color: 'var(--ink)' }}>{value}</span> · <em>unresolved pointer</em>
    </div>
  );
}

function BalanceFooter({ lines }: { lines: JournalLine[] }) {
  const b = sumFunctional(lines);
  const memo = origMemo(lines);
  return (
    <div className="mono" style={{ fontSize: 13, marginTop: 'var(--s-2)' }}>
      <span>Σ DR {b.functionalDebit.toString()} · Σ CR {b.functionalCredit.toString()} · </span>
      <span style={{ color: b.balanced ? 'var(--credit)' : 'var(--debit)', fontWeight: 600 }}>
        Δ {b.delta.toString()} {b.balanced ? '✓' : '✗'}
      </span>
      {Object.keys(memo).length > 0 && (
        <div style={{ color: 'var(--ink-soft)' }}>
          memo (orig ccy, not part of balance): {Object.entries(memo).map(([c, q]) => `${c}:${q.toString()}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

export function EventLineage({ event, entityId, journal }: { event: EventDTO; entityId: string; journal: JournalDTO[] }) {
  const jes = journal.filter((j) => j.eventId === event.id);
  // reverse index: which JE (if any) reverses one of this event's JEs
  const reversedBy = (key: string) => journal.find((j) => j.je.reversalOf === key);

  return (
    <div className="audit-lineage" style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'stretch' }}>
      {/* ① RAW */}
      <StageCard n="①" title="Raw event">
        <pre className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
          {JSON.stringify(event.normalized, null, 2)}
        </pre>
      </StageCard>
      <span aria-hidden className="audit-arrow mono" style={{ alignSelf: 'center', color: 'var(--brass)' }}>{ARROW}</span>

      {/* ② AI */}
      <StageCard n="②" title="Classification">
        {event.ai === null ? (
          <Pending label="awaiting classification" />
        ) : (
          <>
            <div style={{ fontSize: 13 }}>{event.ai.eventType} · {event.ai.purpose}</div>
            <div style={{ margin: 'var(--s-2) 0' }}><ConfidenceBar confidence={event.ai.confidence} compact /></div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>AI opinion — backend assertion, not evidence</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 'var(--s-2)' }}>{event.ai.reasoning}</div>
          </>
        )}
      </StageCard>
      <span aria-hidden className="audit-arrow mono" style={{ alignSelf: 'center', color: 'var(--brass)' }}>{ARROW}</span>

      {/* ③ JE */}
      <StageCard n="③" title="Journal entry">
        {jes.length === 0 ? (
          <Pending label="not yet posted" />
        ) : (
          jes.map((j) => (
            <div key={j.id} style={{ marginBottom: 'var(--s-3)' }}>
              {j.je.reversalOf && (
                <div style={{ fontSize: 11, color: 'var(--brass)', fontWeight: 600 }}>REVERSAL OF → {j.je.reversalOf}</div>
              )}
              {reversedBy(j.idempotencyKey) && (
                <div style={{ fontSize: 11, color: 'var(--brass)', fontWeight: 600 }}>REVERSED BY ← {reversedBy(j.idempotencyKey)!.idempotencyKey}</div>
              )}
              <JournalTable journal={[j]} />
              <BalanceFooter lines={j.je.lines} />
              {j.je.lines.map((l, i) => (
                <div key={i}>
                  <RefRow label="priceRef" value={l.priceRef} />
                  <RefRow label="fxRef" value={l.fxRef} />
                </div>
              ))}
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>rule version not retained in journal (deferred §11)</div>
            </div>
          ))
        )}
      </StageCard>
      <span aria-hidden className="audit-arrow mono" style={{ alignSelf: 'center', color: 'var(--brass)' }}>{ARROW}</span>

      {/* ④ CHAIN (austere) */}
      <div className="austere audit-stage" style={{ flex: 1, minWidth: 0, padding: 'var(--s-4)' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--austere-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>④</div>
        <h4 className="mono" style={{ margin: '2px 0 var(--s-3)', color: 'var(--austere-mono)' }}>On-chain anchor</h4>
        {jes.length === 0 ? (
          <div className="mono" style={{ fontSize: 13, color: 'var(--austere-dim)' }}>◌ not yet anchored</div>
        ) : (
          jes.map((j) => (
            <ProofBadge key={j.id} leafHash={j.leafHash} idempotencyKey={j.idempotencyKey} lineageHash={j.je.lineageHash} entityId={entityId} />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run to verify pass + build**

Run: `cd web && npx vitest run src/components/data/EventLineage.test.tsx src/lib/balance.test.ts` — Expected: PASS.
Run: `cd web && npm run build` — Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add web/src/components/data/EventLineage.tsx web/src/components/data/ProofBadge.tsx web/src/lib/balance.ts web/src/lib/balance.test.ts web/src/components/data/EventLineage.test.tsx
git commit -m "feat(web): EventLineage 4-stage walkthrough (balance footer, reversal/lineageHash, client proof verify, pending states)"
```

---

### Task 6: `EventCompare` — control-consistency matrix

Replaces the stub. Dimensions are rows; events are columns; differing cells light up with brass border + `Δ` glyph + SR-only label (no color-only). Cap = 4, legible.

**Files:**
- Modify (replace stub): `web/src/components/data/EventCompare.tsx`
- Create: `web/src/lib/compareDims.ts`
- Test: `web/src/lib/compareDims.test.ts`, `web/src/components/data/EventCompare.test.tsx`

**Interfaces:**
- Consumes: `EventDTO[]` (the checked set), `JournalDTO[]`.
- Produces:
  - `compareDims.ts`: `buildMatrix(events: EventDTO[], journal: JournalDTO[]): { dimensions: { key: string; label: string; cells: string[]; differs: boolean }[]; shown: EventDTO[]; truncated: number }`

- [ ] **Step 1: Write the failing test (compareDims)**

Create `web/src/lib/compareDims.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMatrix } from './compareDims';
import type { EventDTO, JournalDTO } from '../api/types';

const ev = (id: string, type: string): EventDTO => ({
  id, entityId: 'e', status: 'POSTED', normalized: {},
  ai: { eventType: type, purpose: 'p', counterparty: null, confidence: 0.9, reasoning: '' },
  final: null, routing: null,
});
const je = (eventId: string, accounts: string[]): JournalDTO => ({
  id: `je_${eventId}`, eventId, idempotencyKey: `k_${eventId}`, leafHash: 'h',
  je: { idempotencyKey: `k_${eventId}`, lineageHash: 'l', reversalOf: null,
    lines: accounts.map((a) => ({ account: a, side: 'DEBIT' as const, amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'x' })) },
});

describe('buildMatrix', () => {
  it('marks the eventType row as differing when two events classify differently', () => {
    const m = buildMatrix([ev('A', 'SWAP'), ev('B', 'TRANSFER')], []);
    const row = m.dimensions.find((d) => d.key === 'eventType')!;
    expect(row.differs).toBe(true);
  });
  it('marks account-set row differing when JE account sets diverge', () => {
    const m = buildMatrix([ev('A', 'SWAP'), ev('B', 'SWAP')], [je('A', ['SUI', 'USDC']), je('B', ['SUI'])]);
    expect(m.dimensions.find((d) => d.key === 'accountSet')!.differs).toBe(true);
  });
  it('caps at 4 and reports the truncated count (no silent drop)', () => {
    const events = ['A', 'B', 'C', 'D', 'E'].map((id) => ev(id, 'SWAP'));
    const m = buildMatrix(events, []);
    expect(m.shown).toHaveLength(4);
    expect(m.truncated).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `cd web && npx vitest run src/lib/compareDims.test.ts` → FAIL.

- [ ] **Step 3: Implement `compareDims.ts`**

```ts
// Pure compare-matrix builder (Rule 5: deterministic). Audit-useful dimensions
// (spec §5 / accountant 3.1): not cosmetic leg-count, but control-consistency.
import type { EventDTO, JournalDTO } from '../api/types';
import { sumFunctional } from './balance';

const CAP = 4;

export interface MatrixDim { key: string; label: string; cells: string[]; differs: boolean }
export interface Matrix { dimensions: MatrixDim[]; shown: EventDTO[]; truncated: number }

function jesFor(journal: JournalDTO[], eventId: string): JournalDTO[] {
  return journal.filter((j) => j.eventId === eventId);
}

export function buildMatrix(events: EventDTO[], journal: JournalDTO[]): Matrix {
  const shown = events.slice(0, CAP);
  const truncated = Math.max(0, events.length - CAP);

  const cellsFor = (fn: (e: EventDTO) => string): { cells: string[]; differs: boolean } => {
    const cells = shown.map(fn);
    const differs = new Set(cells).size > 1;
    return { cells, differs };
  };

  const eventType = cellsFor((e) => e.final?.eventType ?? e.ai?.eventType ?? '—');
  const confidence = cellsFor((e) => (e.ai?.confidence == null ? '—' : e.ai.confidence >= 0.85 ? 'AUTO' : 'REVIEW'));
  const accountSet = cellsFor((e) => {
    const accts = jesFor(journal, e.id).flatMap((j) => j.je.lines.map((l) => l.account));
    return [...new Set(accts)].sort().join(',') || '—';
  });
  const balanced = cellsFor((e) => {
    const jes = jesFor(journal, e.id);
    if (jes.length === 0) return '—';
    return jes.every((j) => sumFunctional(j.je.lines).balanced) ? 'balanced' : 'UNBALANCED';
  });
  const anchorStatus = cellsFor((e) => (jesFor(journal, e.id).length > 0 ? 'posted' : 'unposted'));

  return {
    shown,
    truncated,
    dimensions: [
      { key: 'eventType', label: 'AI type', ...eventType },
      { key: 'confidence', label: 'Confidence', ...confidence },
      { key: 'accountSet', label: 'Account set', ...accountSet },
      { key: 'balanced', label: 'Balanced', ...balanced },
      { key: 'anchorStatus', label: 'Posted', ...anchorStatus },
    ],
  };
}
```

> Note: `anchorStatus` here reports posted/unposted from journal presence (the per-JE on-chain state needs `useAnchors` per key — done in Lineage, not in this pure matrix). This is honest: the column says "Posted", not "Anchored". On-chain anchor diffing across the set is a deferred enhancement (§11) to avoid N×M fetches in the matrix (spec §2.5).

- [ ] **Step 4: Run to verify pass** — `cd web && npx vitest run src/lib/compareDims.test.ts` → PASS.

- [ ] **Step 5: Write the failing test (EventCompare)**

Create `web/src/components/data/EventCompare.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { EventCompare } from './EventCompare';
import type { EventDTO } from '../../api/types';

const ev = (id: string, type: string): EventDTO => ({
  id, entityId: 'e', status: 'POSTED', normalized: {},
  ai: { eventType: type, purpose: 'p', counterparty: null, confidence: 0.9, reasoning: '' },
  final: null, routing: null,
});

it('renders one column per compared event', () => {
  render(<EventCompare events={[ev('A', 'SWAP'), ev('B', 'SWAP')]} journal={[]} />);
  expect(screen.getByRole('button', { name: /open lineage for A/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open lineage for B/i })).toBeInTheDocument();
});

it('marks a differing dimension with a non-color Δ label (a11y)', () => {
  render(<EventCompare events={[ev('A', 'SWAP'), ev('B', 'TRANSFER')]} journal={[]} />);
  // SR-only "differs" label present on the differing eventType row
  expect(screen.getAllByText(/differs/i).length).toBeGreaterThan(0);
});

it('shows a legible cap notice when more than 4 events are selected', () => {
  const events = ['A', 'B', 'C', 'D', 'E'].map((id) => ev(id, 'SWAP'));
  render(<EventCompare events={events} journal={[]} />);
  expect(screen.getByText(/4 of 5/i)).toBeInTheDocument();
});
```

> `EventCompare` needs `onOpenLineage?` to satisfy the "Open lineage for X" button. Add it as an optional prop; `AuditWorkspace` wires it to set selection. Update the Task-4 `AuditWorkspace` `<EventCompare .../>` call to pass `onOpenLineage={(id) => { setCompareIds([]); setSelectedId(id); }}` (do this in Step 7 below).

- [ ] **Step 6: Run to verify fail** — `cd web && npx vitest run src/components/data/EventCompare.test.tsx` → FAIL.

- [ ] **Step 7: Implement `EventCompare.tsx`** (replace stub) and wire `onOpenLineage`

```tsx
// DATA ZONE (spec §8.4) — NEVER import Mascot here. Control-consistency matrix (§5).
import type { EventDTO, JournalDTO } from '../../api/types';
import { buildMatrix } from '../../lib/compareDims';

export function EventCompare({ events, journal, onOpenLineage }: {
  events: EventDTO[];
  journal: JournalDTO[];
  onOpenLineage?: (id: string) => void;
}) {
  const m = buildMatrix(events, journal);
  const cols = m.shown.length;

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 'var(--s-3)' }}>
        Comparing {m.shown.length}{m.truncated > 0 ? ` of ${m.shown.length + m.truncated}` : ''} selected
        {m.truncated > 0 && (
          <span style={{ marginLeft: 'var(--s-2)', padding: '1px 7px', borderRadius: 'var(--r-pill)', background: 'var(--brass-fill)' }}>
            +{m.truncated} more not shown
          </span>
        )}
      </div>
      <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 'var(--s-2)', color: 'var(--ink-soft)' }}>Dimension</th>
            {m.shown.map((e) => (
              <th key={e.id} style={{ textAlign: 'left', padding: 'var(--s-2)' }}>
                <button
                  aria-label={`Open lineage for ${e.id}`}
                  onClick={() => onOpenLineage?.(e.id)}
                  style={{ border: 'none', background: 'none', color: 'var(--brass)', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
                >
                  {e.id} ↗
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.dimensions.map((d) => (
            <tr key={d.key} style={{ borderTop: '1px solid var(--paper-line)' }}>
              <td style={{ padding: 'var(--s-2)', color: 'var(--ink-soft)' }}>{d.label}</td>
              {d.cells.map((c, i) => {
                // a cell "differs" iff this row differs AND this cell is not the modal value
                const cellDiffers = d.differs;
                return (
                  <td
                    key={i}
                    style={{
                      padding: 'var(--s-2)',
                      borderLeft: cellDiffers ? '1.5px solid var(--brass)' : '1.5px solid transparent',
                      fontWeight: cellDiffers ? 600 : 400,
                      color: 'var(--ink)',
                    }}
                  >
                    {cellDiffers && <span aria-hidden style={{ color: 'var(--brass)' }}>Δ </span>}
                    {cellDiffers && <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>differs</span>}
                    {c}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div aria-hidden style={{ display: 'none' }}>{cols}</div>
    </div>
  );
}
```

In `web/src/workspaces/AuditWorkspace.tsx`, update the compare render to pass the wiring:

```tsx
        {mode === 'compare' && (
          <EventCompare
            events={list.filter((e) => compareIds.includes(e.id))}
            journal={journal ?? []}
            onOpenLineage={(id) => { setCompareIds([]); setSelectedId(id); }}
          />
        )}
```

- [ ] **Step 8: Run to verify pass + build**

Run: `cd web && npx vitest run src/components/data/EventCompare.test.tsx src/lib/compareDims.test.ts` — Expected: PASS.
Run: `cd web && npm run build` — Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/data/EventCompare.tsx web/src/lib/compareDims.ts web/src/lib/compareDims.test.ts web/src/components/data/EventCompare.test.tsx web/src/workspaces/AuditWorkspace.tsx
git commit -m "feat(web): EventCompare control-consistency matrix (Δ dual-axis diff, legible cap, column→lineage)"
```

---

### Task 7: Register the `'audit'` workspace + RWD

Flip `'audit'` to `ready`, wire `AuditWorkspace` into `App.tsx`, and add the tiered responsive rules (spec §7) to `base.css`.

**Files:**
- Modify: `web/src/app/workspaces.ts:11` (`audit` status → `ready`)
- Modify: `web/src/App.tsx` (import + dispatch `AuditWorkspace`)
- Modify: `web/src/styles/base.css` (append audit RWD block)
- Test: `web/src/App.test.tsx` (add audit-render case)

**Interfaces:**
- Consumes: `AuditWorkspace` (Task 4-6).

- [ ] **Step 1: Write the failing test**

Add to `web/src/App.test.tsx` (match its existing render/provider setup):

```tsx
it('renders the Audit workspace when the audit nav item is selected', async () => {
  renderApp(); // however the file boots the app with providers
  await userEvent.click(screen.getByRole('button', { name: /Audit/ }));
  // pick-one EmptyState OR the list rail is present; assert the workspace mounted (no "coming soon")
  expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
});
```

> Read `web/src/App.test.tsx` first; reuse its existing `renderApp`/provider helper and query-client mock rather than re-inventing. If events fetch is mocked empty, the workspace shows `clear-seas` EmptyState — still asserts "not coming soon".

- [ ] **Step 2: Run to verify fail** — Audit currently renders the `coming soon` EmptyState (status `soon`). Expected: FAIL.

- [ ] **Step 3: Flip the workspace to ready**

In `web/src/app/workspaces.ts` line 11:

```ts
  { id: 'audit',          label: 'Audit',          icon: '🔍', status: 'ready' },
```

- [ ] **Step 4: Wire `AuditWorkspace` into `App.tsx`**

Add the import near the other workspace imports:

```ts
import { AuditWorkspace } from './workspaces/AuditWorkspace';
```

In `WorkspaceContent()` add the dispatch before the `EmptyState` fallback:

```tsx
  if (activeWorkspace === 'exceptions') return <ExceptionsWorkspace />;
  if (activeWorkspace === 'audit') return <AuditWorkspace />;
```

- [ ] **Step 5: Append RWD rules to `base.css`**

Add at the end of `web/src/styles/base.css` (reuses the documented `!important`-over-inline caveat; the audit panes carry the `exceptions-layout` classes so the existing <768px stack-push already applies — these stops add the 4-col→2×2 collapse and arrow rotation):

```css
/* ── Audit workspace lineage RWD (spec §7) ──
   Lineage is a flex row of 4 stage cards + arrows at ≥1280px.
   Below that, collapse to 2×2 then to a vertical accordion. The panes reuse
   .exceptions-layout so the <768px stack-push (list→full-width detail) is inherited. */
@media (max-width: 1280px) {
  .audit-lineage { flex-wrap: wrap !important; }
  .audit-lineage > .audit-stage { flex: 1 1 calc(50% - var(--s-4)) !important; }
  /* arrows between columns become horizontal separators on wrap */
  .audit-lineage > .audit-arrow { display: none; }
}
@media (max-width: 960px) {
  .audit-lineage { flex-direction: column !important; }
  .audit-lineage > .audit-stage { flex: 1 1 auto !important; width: 100%; }
}
```

- [ ] **Step 6: Run tests + build**

Run: `cd web && npx vitest run src/App.test.tsx` — Expected: PASS.
Run: `cd web && npm run build` — Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/workspaces.ts web/src/App.tsx web/src/styles/base.css web/src/App.test.tsx
git commit -m "feat(web): register Audit workspace (ready) + tiered lineage RWD"
```

---

### Task 8: Monkey Testing (test.md mandatory — break it)

Extreme/adversarial tests across the seams. One file, many brutal cases.

**Files:**
- Create: `web/src/test/monkey.audit.test.tsx`

- [ ] **Step 1: Write the monkey suite**

Create `web/src/test/monkey.audit.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deriveMode } from '../lib/auditSelection';
import { sumFunctional } from '../lib/balance';
import { buildMatrix } from '../lib/compareDims';
import { recomputeRoot, resolveProofState } from '../lib/proofVerify';
import { EventLineage } from '../components/data/EventLineage';
import type { EventDTO, JournalDTO, InclusionProof } from '../api/types';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const ev = (over: Partial<EventDTO> = {}): EventDTO => ({
  id: 'E', entityId: 'e', status: 'POSTED', normalized: {}, ai: null, final: null, routing: null, ...over,
});

describe('monkey: selection', () => {
  it('rapid deselect from compare(2) to one leaves lineage, not crash', () => {
    expect(deriveMode({ selectedId: null, compareIds: ['a', 'b'] })).toBe('compare');
    expect(deriveMode({ selectedId: null, compareIds: ['a'] })).toBe('lineage');
    expect(deriveMode({ selectedId: null, compareIds: [] })).toBe('pick');
  });
});

describe('monkey: balance', () => {
  it('empty lines → balanced Δ0 (no NaN, no throw)', () => {
    const r = sumFunctional([]);
    expect(r.delta).toBe(0n);
  });
  it('throws on non-numeric amountMinor (fail-loud, never silent NaN)', () => {
    expect(() => sumFunctional([{ account: 'a', side: 'DEBIT', amountMinor: 'oops', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'x' }])).toThrow();
  });
  it('handles 50 lines of huge minor units without precision loss', () => {
    const big = '12345678901234567890';
    const lines = Array.from({ length: 50 }, (_, i) => ({ account: 'a', side: (i % 2 ? 'CREDIT' : 'DEBIT') as 'DEBIT' | 'CREDIT', amountMinor: big, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'x' }));
    expect(sumFunctional(lines).balanced).toBe(true);
  });
});

describe('monkey: compare matrix', () => {
  it('1 event (degenerate) → no dimension marked differing', () => {
    const m = buildMatrix([ev({ id: 'A', ai: { eventType: 'SWAP', purpose: '', counterparty: null, confidence: 0.9, reasoning: '' } })], []);
    expect(m.dimensions.every((d) => !d.differs)).toBe(true);
  });
  it('20 selected → caps at 4, truncated 16', () => {
    const events = Array.from({ length: 20 }, (_, i) => ev({ id: `E${i}` }));
    const m = buildMatrix(events, []);
    expect(m.shown).toHaveLength(4);
    expect(m.truncated).toBe(16);
  });
});

describe('monkey: proof verify', () => {
  it('tampered sibling → mismatch, never silently verified', async () => {
    const enc = new TextEncoder();
    const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
    const h2b = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
    const leaf = await sha(Uint8Array.of(0x00, ...enc.encode('A')));
    const sib = await sha(Uint8Array.of(0x00, ...enc.encode('B')));
    const root = await recomputeRoot(leaf, [{ hash: sib, position: 'R' }]);
    const tampered: InclusionProof = { idempotencyKey: 'k', leafIndex: 0, siblings: [{ hash: 'ff'.repeat(32), position: 'R' }], merkleRoot: root };
    const s = await resolveProofState({ leafHash: leaf, proof: tampered, anchors: [] });
    expect(s.kind).toBe('mismatch');
    void h2b;
  });
});

describe('monkey: lineage rendering', () => {
  it('reversalOf pointing at a missing JE still renders (no crash)', () => {
    const je: JournalDTO = { id: 'j', eventId: 'E', idempotencyKey: 'k', leafHash: 'h',
      je: { idempotencyKey: 'k', lineageHash: 'l', reversalOf: 'GHOST', lines: [
        { account: 'a', side: 'DEBIT', amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'x' },
        { account: 'b', side: 'CREDIT', amountMinor: '1', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: 'y' },
      ] } };
    wrap(<EventLineage event={ev({ ai: { eventType: 'SWAP', purpose: '', counterparty: null, confidence: 0.5, reasoning: '' } })} entityId="e" journal={[je]} />);
    expect(screen.getByText(/REVERSAL OF → GHOST/)).toBeInTheDocument();
  });
  it('multi-currency JE that balances in functional but not origQty shows balanced ✓ + memo', () => {
    const je: JournalDTO = { id: 'j', eventId: 'E', idempotencyKey: 'k', leafHash: 'h',
      je: { idempotencyKey: 'k', lineageHash: 'l', reversalOf: null, lines: [
        { account: 'SUI', side: 'DEBIT', amountMinor: '100', origCoinType: '0x2::sui::SUI', origQtyMinor: '5', priceRef: null, fxRef: null, leg: 'in' },
        { account: 'USDC', side: 'CREDIT', amountMinor: '100', origCoinType: '0x..::usdc::USDC', origQtyMinor: '100', priceRef: null, fxRef: null, leg: 'out' },
      ] } };
    wrap(<EventLineage event={ev({ ai: { eventType: 'SWAP', purpose: '', counterparty: null, confidence: 0.9, reasoning: '' } })} entityId="e" journal={[je]} />);
    expect(screen.getByText(/Δ 0 ✓/)).toBeInTheDocument();
    expect(screen.getByText(/memo/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `cd web && npx vitest run src/test/monkey.audit.test.tsx`
Expected: PASS (all). If `sumFunctional` does not throw on non-numeric input, that's a real fail-loud gap — fix `balance.ts` to let `BigInt('oops')` throw (it does natively) and ensure no try/catch swallows it.

- [ ] **Step 3: Full regression + build**

Run: `cd web && npm test` — Expected: all green (prior 160 + new).
Run: `cd web && npm run build` — Expected: exit 0.
Run: `cd services/api && npm test` — Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web/src/test/monkey.audit.test.tsx
git commit -m "test(web): monkey suite for Audit workspace (proof tamper, balance edge, cap, missing reversal)"
```

---

## Self-Review

**Spec coverage:**
- §1.2 backend claim / C-1 merkleRoot → Task 1 + Task 2 (type). ✓
- §2.2 1:N JE per event, per-idempotencyKey proof → Task 5 (`jes = journal.filter`, `ProofBadge` per JE). ✓
- §2.3 three proof states + mismatch → Task 2 `resolveProofState`, rendered in Task 5 `ProofBadge`. ✓
- §2.4 read-only (only 3 query hooks) → Tasks 4-5 import only `useEvents`/`useJournal`/`useAnchors`. ✓
- §4 ①②③④ + balance footer (1.1) + reversal/lineageHash (1.5/1.6) + 1.2/1.4 deferred labels → Task 5. ✓
- §5 compare dims (account-set/balance/anchor-status, not leg count) + Δ dual-axis + cap → Task 6. ✓
- §6 browser proof recompute → Task 2 + Task 5. ✓
- §7 tiered RWD → Task 7. ✓
- §8 mascot-free banners, austere only ④, brass thread, brass arrow, filter chips → Tasks 4-7. ✓
- §9 pending/mismatch/not-in-journal states → Tasks 5-6. ✓
- §10 unit+integration+monkey → Tasks across + Task 8. ✓
- §11 deferred: 1.2 rule-version label + 1.4 unresolved-pointer label rendered (Task 5); anchor-status-in-matrix deferred noted (Task 6 note). ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". Every code step shows complete code. ✓ (Task 1 test helpers reference existing `helpers.*` — instruction says read+match, with concrete defaults given.)

**Type consistency:** `deriveMode`/`lineageTarget` (auditSelection) ↔ AuditWorkspace; `resolveProofState`/`recomputeRoot`/`ProofState` ↔ ProofBadge; `sumFunctional`/`origMemo` ↔ EventLineage; `buildMatrix`/`Matrix`/`MatrixDim` ↔ EventCompare; `AnchorDTO.merkleRoot` ↔ Task1 backend + Task2 type + proofVerify. `EventCompare` gains `onOpenLineage?` (declared Task 6, wired in AuditWorkspace same task). ✓

**Investigation outcomes baked in (spec §11, user decision):** 1.2 rule-version NOT in persisted `JournalEntry` (lives in transient `RuleOutput.explanation`) → label "rule version not retained in journal" + defer. 1.4 `priceRef`/`fxRef` are string pointers; values (`PricePoint`/`FxRate`) are run input, not persisted with the JE → render ref + "unresolved pointer" + defer. Both confirmed by reading `services/rules-engine/src/domain/types.ts`.
