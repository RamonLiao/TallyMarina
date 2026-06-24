# Onboarding Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Onboarding workspace — read-only entity/source display plus a dApp Kit personal-message signature that proves Sui wallet ownership, verified server-side and persisted as an append-only attestation.

**Architecture:** Additive backend (2 read endpoints + 1 verify write path, 2 new SQLite tables) feeding a new read-only React workspace. Ownership proof = off-chain personal-message signature; the server issues a single-use nonce challenge, rebuilds the signed message from stored state, and verifies the signature with `@mysten/sui`'s `verifyPersonalMessageSignature`. No private key is ever stored.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, `@mysten/sui ^2` (`/verify`, `/utils`), `@mysten/dapp-kit-react ^2` + `@mysten/dapp-kit-core ^1.6` (already wired), React, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-24-onboarding-workspace-design.md`

## Global Constraints

- **No Move changes.** Pure TS (api + web). sui-code-review not involved; `verify.ts` is an auth path → run **codex dual-review** on completion (dev-rules).
- **Additive only** to existing files; do NOT alter the `entities` table or existing routes/behavior.
- **dApp Kit is already mounted** via `web/src/providers/AppProviders.tsx` (`QueryClientProvider` + `DAppKitProvider dAppKit={dAppKit}`, `wallet/dapp-kit.ts` = `createDAppKit({ networks: ['testnet','mainnet'], defaultNetwork: 'testnet', ... })`). **Do NOT add `SuiClientProvider`/`WalletProvider`/`createNetworkConfig`** — that is the old `@mysten/dapp-kit` API, not this codebase's `dapp-kit-react` v2.
- **Signing API:** no `useSignPersonalMessage` hook in v2. Use `useDAppKit().signPersonalMessage(bytes: Uint8Array): Promise<{ bytes: string, signature: string }>` (base64). Current account via `useCurrentAccount(): UiWalletAccount | null` (`.address`). `ConnectButton` from `@mysten/dapp-kit-react/ui`.
- **Verify API:** `verifyPersonalMessageSignature(message: Uint8Array, signature: string, opts?): Promise<PublicKey>` from `@mysten/sui/verify`. Returns a `PublicKey`; throws on a malformed/invalid signature. To distinguish error codes, call WITHOUT `{ address }`, then compare `normalizeSuiAddress(pubKey.toSuiAddress()) === normalizeSuiAddress(wallet)` manually → `ADDRESS_MISMATCH`. `normalizeSuiAddress` from `@mysten/sui/utils`.
- **Encoding:** server rebuilds the exact UTF-8 message string and signs/verifies over `new TextEncoder().encode(message)`. Never add intent bytes manually (SDK wraps internally). Never trust the client `bytes` field — only `signature`.
- **Message template** (`\n` joins, no trailing newline) — single source `onboarding/message.ts`, imported by both challenge and verify:
  ```
  Subledger ownership proof
  version: v1
  entity: <entityId>
  wallet: <normalized wallet>
  nonce: <nonce>
  expires: <ISO8601 of expiresAt>
  ```
- **Server-fixed constants** (never client-supplied): `verifier`, `initiated_by`, `template_version`.
- **Soft membership gate:** challenge does NOT reject a wallet that isn't a known source. Source list = `deriveSources(events) ∪ { DEMO_OWNED_WALLET }`. A verified wallet not in the list is shown as "verified (unlisted)".
- **Safety invariant:** UNVERIFIED is the safe default; VERIFIED appears ONLY when a server attestation exists. Frontend never self-determines verified.
- **Badge tokens:** UNVERIFIED → `--ink-soft`; VERIFIED → `--credit` (green). NEVER `--aqua` (reserved on-chain). No amber.
- **Demo entity id:** `acme:pilot-001` (from `config.ENTITY_ID`).

## File Structure

**Backend (`services/api/src/`)**
- `onboarding/constants.ts` — entity-meta map, `DEMO_OWNED_WALLET`, message-template/version, verifier/initiated-by constants, challenge TTL.
- `onboarding/message.ts` — `buildOwnershipMessage` + `encodeOwnershipMessage` (single template source).
- `onboarding/sources.ts` — `deriveSources(db, entityId)` (distinct wallet from events ∪ demo-owned).
- `onboarding/challenge.ts` — `issueChallenge(db, entityId, wallet, now)`.
- `onboarding/verify.ts` — `verifyOwnership(db, input, now)` (async crypto verify, then atomic consume+attest).
- `store/onboardingStore.ts` — challenge + attestation row I/O.
- `store/schema.sql` — append `onboarding_challenge` + `wallet_ownership_attestation` tables.
- `http/routes.ts` — register `GET /onboarding/:id`, `POST /onboarding/challenge`, `POST /onboarding/verify`.

**Frontend (`web/src/`)**
- `api/types.ts` — add onboarding DTO types.
- `api/endpoints.ts` — `getOnboarding`, `postOnboardingChallenge`, `postOnboardingVerify`.
- `data/useOnboardingData.ts` — GET fetch with render-time cross-key gate.
- `data/usePersonalWalletOwnership.ts` — sign + verify flow state machine.
- `workspaces/onboarding/{OnboardingWorkspace,EntitySummaryCard,SourceTable}.tsx` + `onboarding.css`.
- `App.tsx` — route `onboarding` → `OnboardingWorkspace`.
- `app/workspaces.ts` — `onboarding` status `soon` → `ready`.

---

### Task 1: DB schema + onboardingStore

**Files:**
- Modify: `services/api/src/store/schema.sql` (append two tables)
- Create: `services/api/src/store/onboardingStore.ts`
- Test: `services/api/test/onboardingStore.test.ts`

**Interfaces:**
- Produces:
  - `ChallengeRow { entityId: string; wallet: string; nonce: string; expiresAt: number; consumedAt: number | null; createdAt: number }`
  - `AttestationRow { id: string; entityId: string; wallet: string; nonce: string; verifier: string; initiatedBy: string; messageSnapshot: string; templateVersion: string; connectedAccount: string; verifiedAt: number }`
  - `insertChallenge(db, c: ChallengeRow): void`
  - `getOpenChallenge(db, entityId, wallet, nonce, now): ChallengeRow | null` (only non-consumed, non-expired)
  - `consumeChallenge(db, entityId, wallet, nonce, now): boolean` (atomic; true iff it transitioned NULL→consumed)
  - `insertAttestation(db, a: AttestationRow): void`
  - `listAttestations(db, entityId): AttestationRow[]`
  - `latestAttestation(db, entityId, wallet): AttestationRow | null`

- [ ] **Step 1: Append tables to `schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS onboarding_challenge (
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  wallet      TEXT NOT NULL,
  nonce       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (entity_id, wallet, nonce)
);
CREATE TABLE IF NOT EXISTS wallet_ownership_attestation (
  id               TEXT PRIMARY KEY,
  entity_id        TEXT NOT NULL REFERENCES entities(id),
  wallet           TEXT NOT NULL,
  nonce            TEXT NOT NULL,
  verifier         TEXT NOT NULL,
  initiated_by     TEXT NOT NULL,
  message_snapshot TEXT NOT NULL,
  template_version TEXT NOT NULL,
  connected_account TEXT NOT NULL,
  verified_at      INTEGER NOT NULL
);
```

- [ ] **Step 2: Write the failing test**

```ts
// services/api/test/onboardingStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import {
  insertChallenge, getOpenChallenge, consumeChallenge,
  insertAttestation, listAttestations, latestAttestation,
} from '../src/store/onboardingStore.js';

let db: Db;
const E = 'acme:pilot-001';
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
});

describe('onboardingStore', () => {
  it('getOpenChallenge returns only non-consumed, non-expired', () => {
    insertChallenge(db, { entityId: E, wallet: '0xw', nonce: 'n1', expiresAt: 1000, consumedAt: null, createdAt: 0 });
    expect(getOpenChallenge(db, E, '0xw', 'n1', 999)?.nonce).toBe('n1');
    expect(getOpenChallenge(db, E, '0xw', 'n1', 1001)).toBeNull(); // expired
  });

  it('consumeChallenge is atomic single-use', () => {
    insertChallenge(db, { entityId: E, wallet: '0xw', nonce: 'n2', expiresAt: 1000, consumedAt: null, createdAt: 0 });
    expect(consumeChallenge(db, E, '0xw', 'n2', 500)).toBe(true);
    expect(consumeChallenge(db, E, '0xw', 'n2', 500)).toBe(false); // already used
    expect(getOpenChallenge(db, E, '0xw', 'n2', 500)).toBeNull();
  });

  it('attestation append + latest by wallet', () => {
    const base = { entityId: E, wallet: '0xw', nonce: 'n3', verifier: 'v', initiatedBy: 'op', messageSnapshot: 'm', templateVersion: 'v1', connectedAccount: '0xw' };
    insertAttestation(db, { ...base, id: 'a1', verifiedAt: 100 });
    insertAttestation(db, { ...base, id: 'a2', nonce: 'n4', verifiedAt: 200 });
    expect(listAttestations(db, E)).toHaveLength(2);
    expect(latestAttestation(db, E, '0xw')?.id).toBe('a2');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/onboardingStore.test.ts`
Expected: FAIL — cannot find module `onboardingStore.js`.

- [ ] **Step 4: Implement `onboardingStore.ts`**

```ts
// services/api/src/store/onboardingStore.ts
import type { Db } from './db.js';

export interface ChallengeRow {
  entityId: string; wallet: string; nonce: string;
  expiresAt: number; consumedAt: number | null; createdAt: number;
}
export interface AttestationRow {
  id: string; entityId: string; wallet: string; nonce: string;
  verifier: string; initiatedBy: string; messageSnapshot: string;
  templateVersion: string; connectedAccount: string; verifiedAt: number;
}

export function insertChallenge(db: Db, c: ChallengeRow): void {
  db.prepare(
    `INSERT INTO onboarding_challenge (entity_id, wallet, nonce, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(c.entityId, c.wallet, c.nonce, c.expiresAt, c.consumedAt, c.createdAt);
}

export function getOpenChallenge(db: Db, entityId: string, wallet: string, nonce: string, now: number): ChallengeRow | null {
  const r = db.prepare(
    `SELECT * FROM onboarding_challenge
     WHERE entity_id = ? AND wallet = ? AND nonce = ? AND consumed_at IS NULL AND expires_at > ?`,
  ).get(entityId, wallet, nonce, now) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    entityId: r.entity_id as string, wallet: r.wallet as string, nonce: r.nonce as string,
    expiresAt: r.expires_at as number, consumedAt: (r.consumed_at as number | null) ?? null, createdAt: r.created_at as number,
  };
}

export function consumeChallenge(db: Db, entityId: string, wallet: string, nonce: string, now: number): boolean {
  const info = db.prepare(
    `UPDATE onboarding_challenge SET consumed_at = ?
     WHERE entity_id = ? AND wallet = ? AND nonce = ? AND consumed_at IS NULL AND expires_at > ?`,
  ).run(now, entityId, wallet, nonce, now);
  return info.changes === 1;
}

function mapAtt(r: Record<string, unknown>): AttestationRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, wallet: r.wallet as string, nonce: r.nonce as string,
    verifier: r.verifier as string, initiatedBy: r.initiated_by as string, messageSnapshot: r.message_snapshot as string,
    templateVersion: r.template_version as string, connectedAccount: r.connected_account as string, verifiedAt: r.verified_at as number,
  };
}

export function insertAttestation(db: Db, a: AttestationRow): void {
  db.prepare(
    `INSERT INTO wallet_ownership_attestation
       (id, entity_id, wallet, nonce, verifier, initiated_by, message_snapshot, template_version, connected_account, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.id, a.entityId, a.wallet, a.nonce, a.verifier, a.initiatedBy, a.messageSnapshot, a.templateVersion, a.connectedAccount, a.verifiedAt);
}

export function listAttestations(db: Db, entityId: string): AttestationRow[] {
  return (db.prepare('SELECT * FROM wallet_ownership_attestation WHERE entity_id = ? ORDER BY verified_at').all(entityId) as Record<string, unknown>[]).map(mapAtt);
}

export function latestAttestation(db: Db, entityId: string, wallet: string): AttestationRow | null {
  const r = db.prepare(
    'SELECT * FROM wallet_ownership_attestation WHERE entity_id = ? AND wallet = ? ORDER BY verified_at DESC LIMIT 1',
  ).get(entityId, wallet) as Record<string, unknown> | undefined;
  return r ? mapAtt(r) : null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/onboardingStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/api/src/store/schema.sql services/api/src/store/onboardingStore.ts services/api/test/onboardingStore.test.ts
git commit -m "feat(onboarding): challenge + attestation tables and store"
```

---

### Task 2: Constants + message template (anti-drift, byte-golden)

**Files:**
- Create: `services/api/src/onboarding/constants.ts`
- Create: `services/api/src/onboarding/message.ts`
- Test: `services/api/test/onboardingMessage.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:
  - `constants.ts`: `OWNERSHIP_VERIFIER`, `OWNERSHIP_INITIATED_BY`, `OWNERSHIP_TEMPLATE_VERSION`, `CHALLENGE_TTL_MS`, `DEMO_OWNED_WALLET`, `EntityMeta`, `DEMO_ENTITY_META: Record<string, EntityMeta>`.
  - `message.ts`: `OwnershipMessageInput { entityId; wallet; nonce; expiresAt }`, `buildOwnershipMessage(i): string`, `encodeOwnershipMessage(i): Uint8Array`.

- [ ] **Step 1: Write `constants.ts`**

```ts
// services/api/src/onboarding/constants.ts
export const OWNERSHIP_VERIFIER = 'subledger-api/onboarding-verifier@v1';
export const OWNERSHIP_INITIATED_BY = 'demo-operator';
export const OWNERSHIP_TEMPLATE_VERSION = 'v1';
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// A real testnet address the demo presenter controls, seeded as a listed source
// so the happy-path verify row is clickable. Overridable via env for live demos.
export const DEMO_OWNED_WALLET =
  process.env.ONBOARDING_DEMO_WALLET ?? '0x0000000000000000000000000000000000000000000000000000000000000abc';

export interface EntityMeta {
  functionalCurrency: string;
  reportingCurrency: string;
  fiscalCalendar: string;
  timezone: string;
}

// Entity meta lives here (entities table has no currency/calendar columns; see spec §2).
export const DEMO_ENTITY_META: Record<string, EntityMeta> = {
  'acme:pilot-001': {
    functionalCurrency: 'USD',
    reportingCurrency: 'USD',
    fiscalCalendar: 'Jan–Dec (calendar year)',
    timezone: 'America/New_York',
  },
};
```

- [ ] **Step 2: Write the failing test (byte-golden)**

```ts
// services/api/test/onboardingMessage.test.ts
import { describe, it, expect } from 'vitest';
import { buildOwnershipMessage, encodeOwnershipMessage } from '../src/onboarding/message.js';

const input = { entityId: 'acme:pilot-001', wallet: '0xabc', nonce: 'deadbeef', expiresAt: 1_717_200_000_000 };

describe('ownership message', () => {
  it('builds the exact domain-bound template (string golden)', () => {
    expect(buildOwnershipMessage(input)).toBe(
      [
        'Subledger ownership proof',
        'version: v1',
        'entity: acme:pilot-001',
        'wallet: 0xabc',
        'nonce: deadbeef',
        'expires: 2024-06-01T00:00:00.000Z',
      ].join('\n'),
    );
  });

  it('encodes UTF-8 bytes deterministically (byte golden)', () => {
    const bytes = encodeOwnershipMessage(input);
    // round-trips through TextEncoder; lock length + no trailing newline
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[bytes.length - 1]).not.toBe(0x0a); // no trailing \n
    expect(new TextDecoder().decode(bytes)).toBe(buildOwnershipMessage(input));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/onboardingMessage.test.ts`
Expected: FAIL — cannot find module `message.js`.

- [ ] **Step 4: Implement `message.ts`**

```ts
// services/api/src/onboarding/message.ts
import { OWNERSHIP_TEMPLATE_VERSION } from './constants.js';

export interface OwnershipMessageInput {
  entityId: string; wallet: string; nonce: string; expiresAt: number;
}

export function buildOwnershipMessage(i: OwnershipMessageInput): string {
  return [
    'Subledger ownership proof',
    `version: ${OWNERSHIP_TEMPLATE_VERSION}`,
    `entity: ${i.entityId}`,
    `wallet: ${i.wallet}`,
    `nonce: ${i.nonce}`,
    `expires: ${new Date(i.expiresAt).toISOString()}`,
  ].join('\n');
}

export function encodeOwnershipMessage(i: OwnershipMessageInput): Uint8Array {
  return new TextEncoder().encode(buildOwnershipMessage(i));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/onboardingMessage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add services/api/src/onboarding/constants.ts services/api/src/onboarding/message.ts services/api/test/onboardingMessage.test.ts
git commit -m "feat(onboarding): constants + domain-bound message template (byte-golden)"
```

---

### Task 3: deriveSources

**Files:**
- Create: `services/api/src/onboarding/sources.ts`
- Test: `services/api/test/onboardingSources.test.ts`

**Interfaces:**
- Consumes: `listEvents` from `store/eventStore.js` (returns rows with `.id`, `.rawJson`); `DEMO_OWNED_WALLET`.
- Produces: `DerivedSource { wallet: string; eventCount: number; isDemoOwned: boolean }`, `deriveSources(db, entityId): DerivedSource[]`.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/onboardingSources.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent } from '../src/store/eventStore.js';
import { deriveSources } from '../src/onboarding/sources.js';
import { DEMO_OWNED_WALLET } from '../src/onboarding/constants.js';

let db: Db;
const E = 'acme:pilot-001';
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
});

function addEvent(id: string, wallet: string) {
  insertEvent(db, {
    id, entityId: E, rawJson: JSON.stringify({ wallet }),
    aiEventType: null, aiPurpose: null, aiCounterparty: null, aiConfidence: null, aiReasoning: null,
    finalEventType: null, finalPurpose: null, status: 'NEW',
  });
}

describe('deriveSources', () => {
  it('returns distinct wallets ∪ DEMO_OWNED_WALLET with counts', () => {
    addEvent('e1', '0xacmeTreasury');
    addEvent('e2', '0xacmeTreasury');
    addEvent('e3', '0xcustomerA');
    const s = deriveSources(db, E);
    const treasury = s.find((x) => x.wallet === '0xacmeTreasury');
    expect(treasury?.eventCount).toBe(2);
    expect(s.some((x) => x.wallet === '0xcustomerA')).toBe(true);
    const demo = s.find((x) => x.wallet === DEMO_OWNED_WALLET);
    expect(demo?.isDemoOwned).toBe(true);
    expect(demo?.eventCount).toBe(0);
  });
});
```

Note: confirm the exact `insertEvent` row shape from `services/api/src/store/eventStore.ts` before writing — match its `EventRow` fields verbatim (the fields above mirror the `events` schema: ai_*, final_*, status). If `insertEvent` is not exported, insert via raw `db.prepare(...)` against the `events` table instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/onboardingSources.test.ts`
Expected: FAIL — cannot find module `sources.js`.

- [ ] **Step 3: Implement `sources.ts`**

```ts
// services/api/src/onboarding/sources.ts
import type { Db } from '../store/db.js';
import { listEvents } from '../store/eventStore.js';
import { DEMO_OWNED_WALLET } from './constants.js';

export interface DerivedSource {
  wallet: string;
  eventCount: number;
  isDemoOwned: boolean;
}

export function deriveSources(db: Db, entityId: string): DerivedSource[] {
  const counts = new Map<string, number>();
  for (const ev of listEvents(db, entityId)) {
    const wallet = (JSON.parse(ev.rawJson) as { wallet?: string }).wallet;
    if (!wallet) throw new Error(`onboarding: event ${ev.id} has no wallet`);
    counts.set(wallet, (counts.get(wallet) ?? 0) + 1);
  }
  if (!counts.has(DEMO_OWNED_WALLET)) counts.set(DEMO_OWNED_WALLET, 0);
  return [...counts.entries()]
    .map(([wallet, eventCount]) => ({ wallet, eventCount, isDemoOwned: wallet === DEMO_OWNED_WALLET }))
    .sort((a, b) => a.wallet.localeCompare(b.wallet));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/onboardingSources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/onboarding/sources.ts services/api/test/onboardingSources.test.ts
git commit -m "feat(onboarding): deriveSources (events ∪ demo-owned wallet)"
```

---

### Task 4: issueChallenge

**Files:**
- Create: `services/api/src/onboarding/challenge.ts`
- Test: `services/api/test/onboardingChallenge.test.ts`

**Interfaces:**
- Consumes: `normalizeSuiAddress` (`@mysten/sui/utils`), `insertChallenge`, `buildOwnershipMessage`, `CHALLENGE_TTL_MS`, `getEntity`.
- Produces: `issueChallenge(db, entityId, walletRaw, now): { nonce: string; message: string; expiresAt: number; wallet: string }`. Throws `ApiError(404,'ENTITY_NOT_FOUND')` if entity missing. **Soft gate:** does NOT reject non-source wallets.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/onboardingChallenge.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { issueChallenge } from '../src/onboarding/challenge.js';
import { getOpenChallenge } from '../src/store/onboardingStore.js';

let db: Db;
const E = 'acme:pilot-001';
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
});

describe('issueChallenge', () => {
  it('issues a stored, retrievable nonce for ANY wallet (soft gate)', () => {
    const r = issueChallenge(db, E, '0xSomeRandomWallet', 1000);
    expect(r.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(r.expiresAt).toBe(1000 + 5 * 60 * 1000);
    expect(r.message).toContain(`nonce: ${r.nonce}`);
    expect(getOpenChallenge(db, E, r.wallet, r.nonce, 1000)).not.toBeNull();
  });

  it('throws ENTITY_NOT_FOUND for unknown entity', () => {
    expect(() => issueChallenge(db, 'nope', '0xw', 1000)).toThrow(/ENTITY_NOT_FOUND|no entity/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/onboardingChallenge.test.ts`
Expected: FAIL — cannot find module `challenge.js`.

- [ ] **Step 3: Implement `challenge.ts`**

```ts
// services/api/src/onboarding/challenge.ts
import { randomBytes } from 'node:crypto';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import type { Db } from '../store/db.js';
import { getEntity } from '../store/entityStore.js';
import { insertChallenge } from '../store/onboardingStore.js';
import { buildOwnershipMessage } from './message.js';
import { CHALLENGE_TTL_MS } from './constants.js';
import { ApiError } from '../http/errors.js';

export function issueChallenge(db: Db, entityId: string, walletRaw: string, now: number) {
  if (!getEntity(db, entityId)) throw new ApiError(404, 'ENTITY_NOT_FOUND', `no entity ${entityId}`);
  const wallet = normalizeSuiAddress(walletRaw);
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = now + CHALLENGE_TTL_MS;
  insertChallenge(db, { entityId, wallet, nonce, expiresAt, consumedAt: null, createdAt: now });
  const message = buildOwnershipMessage({ entityId, wallet, nonce, expiresAt });
  return { nonce, message, expiresAt, wallet };
}
```

Note: `normalizeSuiAddress` expects hex; the demo flow sends real wallet addresses. If a test passes a non-hex string it may throw — that's acceptable (only real addresses reach this in the demo). Keep `'0xSomeRandomWallet'`-style test inputs hex-only if `normalizeSuiAddress` rejects them; otherwise use a 0x + hex string like `'0xabc'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/onboardingChallenge.test.ts`
Expected: PASS. (If `normalizeSuiAddress('0xSomeRandomWallet')` throws on non-hex, change the test wallet to `'0xabc'`.)

- [ ] **Step 5: Commit**

```bash
git add services/api/src/onboarding/challenge.ts services/api/test/onboardingChallenge.test.ts
git commit -m "feat(onboarding): issueChallenge (soft gate, entity-existence check)"
```

---

### Task 5: verifyOwnership (core auth path)

**Files:**
- Create: `services/api/src/onboarding/verify.ts`
- Test: `services/api/test/onboardingVerify.test.ts`

**Interfaces:**
- Consumes: `verifyPersonalMessageSignature` (`@mysten/sui/verify`), `normalizeSuiAddress` (`@mysten/sui/utils`), `getOpenChallenge`, `consumeChallenge`, `insertAttestation`, `encodeOwnershipMessage`, `buildOwnershipMessage`, ownership constants, `ApiError`.
- Produces: `VerifyInput { entityId; wallet; nonce; signature; connectedAccount }`, `verifyOwnership(db, input, now): Promise<AttestationRow>`.

Behavior: (1) load open challenge by (entity, normalized wallet, nonce) → else `CHALLENGE_INVALID`; (2) rebuild bytes from stored challenge; (3) `verifyPersonalMessageSignature(bytes, signature)` WITHOUT `{address}` → on throw `BAD_SIGNATURE`; (4) `normalizeSuiAddress(pubKey.toSuiAddress()) !== wallet` → `ADDRESS_MISMATCH` (nonce NOT consumed in steps 3-4); (5) in a single `db.transaction`: `consumeChallenge` (false → `CHALLENGE_INVALID`) then `insertAttestation`.

- [ ] **Step 1: Write the failing test (real signatures)**

```ts
// services/api/test/onboardingVerify.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { issueChallenge } from '../src/onboarding/challenge.js';
import { verifyOwnership } from '../src/onboarding/verify.js';
import { encodeOwnershipMessage } from '../src/onboarding/message.js';
import { listAttestations } from '../src/store/onboardingStore.js';

let db: Db;
const E = 'acme:pilot-001';
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
});

async function signFor(kp: Ed25519Keypair | Secp256k1Keypair, now = 1000) {
  const wallet = kp.toSuiAddress();
  const { nonce, expiresAt } = issueChallenge(db, E, wallet, now);
  const bytes = encodeOwnershipMessage({ entityId: E, wallet, nonce, expiresAt });
  const { signature } = await kp.signPersonalMessage(bytes);
  return { wallet, nonce, signature };
}

describe('verifyOwnership', () => {
  it('accepts a valid Ed25519 signature and writes an attestation', async () => {
    const kp = new Ed25519Keypair();
    const { wallet, nonce, signature } = await signFor(kp);
    const att = await verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000);
    expect(att.wallet).toBe(wallet);
    expect(att.verifier).toBe('subledger-api/onboarding-verifier@v1');
    expect(att.initiatedBy).toBe('demo-operator');
    expect(listAttestations(db, E)).toHaveLength(1);
  });

  it('accepts a Secp256k1 signature (scheme-agnostic)', async () => {
    const kp = new Secp256k1Keypair();
    const { wallet, nonce, signature } = await signFor(kp);
    const att = await verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000);
    expect(att.wallet).toBe(wallet);
  });

  it('rejects a tampered signature → BAD_SIGNATURE, nonce not consumed', async () => {
    const kp = new Ed25519Keypair();
    const { wallet, nonce, signature } = await signFor(kp);
    const bad = signature.slice(0, -4) + 'AAAA';
    await expect(verifyOwnership(db, { entityId: E, wallet, nonce, signature: bad, connectedAccount: wallet }, 1000))
      .rejects.toThrow(/BAD_SIGNATURE/);
    // nonce still open → a correct retry works
    const att = await verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000);
    expect(att.wallet).toBe(wallet);
  });

  it('rejects a signature from a different key → ADDRESS_MISMATCH', async () => {
    const owner = new Ed25519Keypair();
    const attacker = new Ed25519Keypair();
    const wallet = owner.toSuiAddress();
    const { nonce, expiresAt } = issueChallenge(db, E, wallet, 1000);
    const bytes = encodeOwnershipMessage({ entityId: E, wallet, nonce, expiresAt });
    const { signature } = await attacker.signPersonalMessage(bytes); // attacker signs, claims owner's wallet
    await expect(verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000))
      .rejects.toThrow(/ADDRESS_MISMATCH/);
  });

  it('rejects replay of a consumed nonce → CHALLENGE_INVALID', async () => {
    const kp = new Ed25519Keypair();
    const { wallet, nonce, signature } = await signFor(kp);
    await verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000);
    await expect(verifyOwnership(db, { entityId: E, wallet, nonce, signature, connectedAccount: wallet }, 1000))
      .rejects.toThrow(/CHALLENGE_INVALID/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/onboardingVerify.test.ts`
Expected: FAIL — cannot find module `verify.js`.

- [ ] **Step 3: Implement `verify.ts`**

```ts
// services/api/src/onboarding/verify.ts
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import type { Db } from '../store/db.js';
import {
  getOpenChallenge, consumeChallenge, insertAttestation, type AttestationRow,
} from '../store/onboardingStore.js';
import { encodeOwnershipMessage, buildOwnershipMessage } from './message.js';
import { OWNERSHIP_VERIFIER, OWNERSHIP_INITIATED_BY, OWNERSHIP_TEMPLATE_VERSION } from './constants.js';
import { ApiError } from '../http/errors.js';

export interface VerifyInput {
  entityId: string; wallet: string; nonce: string; signature: string; connectedAccount: string;
}

export async function verifyOwnership(db: Db, input: VerifyInput, now: number): Promise<AttestationRow> {
  const wallet = normalizeSuiAddress(input.wallet);
  const ch = getOpenChallenge(db, input.entityId, wallet, input.nonce, now);
  if (!ch) throw new ApiError(422, 'CHALLENGE_INVALID', 'challenge missing, expired, or already used');

  const bytes = encodeOwnershipMessage({ entityId: ch.entityId, wallet, nonce: ch.nonce, expiresAt: ch.expiresAt });

  // (a) crypto verify (no DB mutation). Throws on malformed/invalid signature.
  let pubKey;
  try {
    pubKey = await verifyPersonalMessageSignature(bytes, input.signature);
  } catch (e) {
    throw new ApiError(422, 'BAD_SIGNATURE', `signature verification failed: ${(e as Error).message}`);
  }
  // (b) bind recovered address to the claimed wallet
  if (normalizeSuiAddress(pubKey.toSuiAddress()) !== wallet) {
    throw new ApiError(422, 'ADDRESS_MISMATCH', 'signature valid but not produced by this wallet');
  }

  // (c) atomic single-use consume + append-only attestation
  const messageSnapshot = buildOwnershipMessage({ entityId: ch.entityId, wallet, nonce: ch.nonce, expiresAt: ch.expiresAt });
  const att: AttestationRow = {
    id: `att-${input.entityId}-${wallet}-${ch.nonce}`,
    entityId: input.entityId, wallet, nonce: ch.nonce,
    verifier: OWNERSHIP_VERIFIER, initiatedBy: OWNERSHIP_INITIATED_BY,
    messageSnapshot, templateVersion: OWNERSHIP_TEMPLATE_VERSION,
    connectedAccount: input.connectedAccount, verifiedAt: now,
  };
  const run = db.transaction(() => {
    if (!consumeChallenge(db, input.entityId, wallet, input.nonce, now)) {
      throw new ApiError(422, 'CHALLENGE_INVALID', 'challenge already used');
    }
    insertAttestation(db, att);
    return att;
  });
  return run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/onboardingVerify.test.ts`
Expected: PASS (5 tests). If `@mysten/sui/keypairs/secp256k1` import path differs, confirm against `services/api/node_modules/@mysten/sui` and adjust.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/onboarding/verify.ts services/api/test/onboardingVerify.test.ts
git commit -m "feat(onboarding): verifyOwnership — server-side signature verify + atomic attestation"
```

---

### Task 6: Routes wiring (3 endpoints)

**Files:**
- Modify: `services/api/src/http/routes.ts` (imports + 3 handlers, placed near the `GET /policy/active` block)
- Test: `services/api/test/onboardingRoute.test.ts`

**Interfaces:**
- Consumes: `deriveSources`, `issueChallenge`, `verifyOwnership`, `latestAttestation`, `listAttestations`, `getEntity`, `DEMO_ENTITY_META`.
- Produces (HTTP):
  - `GET /onboarding/:id` → `{ entity: { id, displayName, meta }, sources: Array<{ wallet, eventCount, isDemoOwned, ownership: { verified: boolean, verifiedAt?: number } }>, unlistedVerified: Array<{ wallet, verifiedAt }> }`
  - `POST /onboarding/challenge` body `{ wallet }` → `{ nonce, message, expiresAt, wallet }`
  - `POST /onboarding/verify` body `{ wallet, nonce, signature, connectedAccount }` → `{ verdict: 'VERIFIED', attestation: { wallet, verifiedAt, verifier, templateVersion } }`

Use `Date.now()` for `now` in handlers (matches existing route style for timestamps).

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/onboardingRoute.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { openDb } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { registerRoutes } from '../src/http/routes.js';
import { loadConfig } from '../src/config.js';
import { encodeOwnershipMessage } from '../src/onboarding/message.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';

const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'https://grpc', ANCHOR_PACKAGE_ID: '0xpkg',
  ANCHOR_ORIGINAL_PACKAGE_ID: '0xpkg', ENTITY_ID: 'acme:pilot-001',
  ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm1', AI_MODEL_COPILOT: 'm2',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});
const stub: GeminiClient = { async generateJson() { return {} as never; } };

let app: FastifyInstance;
const E = 'acme:pilot-001';
beforeEach(async () => {
  const db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme Pilot', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
  app = Fastify();
  registerRoutes(app, {
    db, cfg, classifyClient: stub, copilotClient: stub,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
  } as never);
  await app.ready();
});

describe('onboarding routes', () => {
  it('GET /onboarding/:id returns entity meta + sources with ownership state', async () => {
    const res = await app.inject({ method: 'GET', url: `/onboarding/${E}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entity.meta.functionalCurrency).toBe('USD');
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.every((s: { ownership: { verified: boolean } }) => s.ownership.verified === false)).toBe(true);
  });

  it('full challenge → sign → verify round-trip flips ownership to verified', async () => {
    const kp = new Ed25519Keypair();
    const wallet = kp.toSuiAddress();
    const ch = await app.inject({ method: 'POST', url: '/onboarding/challenge', payload: { wallet } });
    const { nonce, expiresAt } = ch.json();
    const bytes = encodeOwnershipMessage({ entityId: E, wallet, nonce, expiresAt });
    const { signature } = await kp.signPersonalMessage(bytes);
    const v = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet, nonce, signature, connectedAccount: wallet } });
    expect(v.statusCode).toBe(200);
    expect(v.json().verdict).toBe('VERIFIED');
    // wallet not a derived source → shows up as unlistedVerified
    const after = await app.inject({ method: 'GET', url: `/onboarding/${E}` });
    const u = after.json().unlistedVerified;
    expect(u.some((x: { wallet: string }) => x.wallet === require('@mysten/sui/utils').normalizeSuiAddress(wallet))).toBe(true);
  });

  it('GET unknown entity → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/onboarding/nope' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/onboardingRoute.test.ts`
Expected: FAIL — routes return 404 (not registered).

- [ ] **Step 3: Add imports + handlers to `routes.ts`**

Add near the other store/onboarding imports at the top:

```ts
import { deriveSources } from '../onboarding/sources.js';
import { issueChallenge } from '../onboarding/challenge.js';
import { verifyOwnership } from '../onboarding/verify.js';
import { latestAttestation, listAttestations } from '../store/onboardingStore.js';
import { DEMO_ENTITY_META } from '../onboarding/constants.js';
import { normalizeSuiAddress } from '@mysten/sui/utils';
```

Add the handlers immediately after the `GET /policy/active` block:

```ts
  // GET /onboarding/:id — entity meta + derived sources + ownership attestation state
  app.get<{ Params: { id: string } }>('/onboarding/:id', async (req) => {
    const entity = requireEntity(db, req.params.id); // throws ApiError 404 if missing
    const sources = deriveSources(db, req.params.id);
    const listed = new Set(sources.map((s) => normalizeSuiAddress(s.wallet)));
    const sourcesOut = sources.map((s) => {
      const att = latestAttestation(db, req.params.id, normalizeSuiAddress(s.wallet));
      return {
        wallet: s.wallet, eventCount: s.eventCount, isDemoOwned: s.isDemoOwned,
        ownership: att ? { verified: true, verifiedAt: att.verifiedAt } : { verified: false },
      };
    });
    const unlistedVerified = listAttestations(db, req.params.id)
      .filter((a) => !listed.has(a.wallet))
      // dedupe by wallet keeping latest
      .reduce<Record<string, { wallet: string; verifiedAt: number }>>((acc, a) => {
        if (!acc[a.wallet] || a.verifiedAt > acc[a.wallet].verifiedAt) acc[a.wallet] = { wallet: a.wallet, verifiedAt: a.verifiedAt };
        return acc;
      }, {});
    return {
      entity: { id: entity.id, displayName: entity.displayName, meta: DEMO_ENTITY_META[entity.id] ?? null },
      sources: sourcesOut,
      unlistedVerified: Object.values(unlistedVerified),
    };
  });

  // POST /onboarding/challenge — issue single-use nonce
  app.post<{ Body: { wallet?: string } }>('/onboarding/challenge', async (req) => {
    if (!req.body?.wallet) throw new ApiError(400, 'VALIDATION', 'wallet required');
    return issueChallenge(db, cfg.entityId, req.body.wallet, Date.now());
  });

  // POST /onboarding/verify — server-side signature verification → attestation
  app.post<{ Body: { wallet?: string; nonce?: string; signature?: string; connectedAccount?: string } }>(
    '/onboarding/verify',
    async (req) => {
      const { wallet, nonce, signature, connectedAccount } = req.body ?? {};
      if (!wallet || !nonce || !signature) throw new ApiError(400, 'VALIDATION', 'wallet, nonce, signature required');
      const att = await verifyOwnership(
        db,
        { entityId: cfg.entityId, wallet, nonce, signature, connectedAccount: connectedAccount ?? wallet },
        Date.now(),
      );
      return { verdict: 'VERIFIED', attestation: { wallet: att.wallet, verifiedAt: att.verifiedAt, verifier: att.verifier, templateVersion: att.templateVersion } };
    },
  );
```

Notes:
- `requireEntity` already exists in `routes.ts` (throws `ApiError(404,'ENTITY_NOT_FOUND')`) and returns the `EntityRow` — reuse it.
- `cfg.entityId` is the single demo entity. Confirm the exact property name on `ApiConfig` (`cfg.entityId`) in `services/api/src/config.ts`; if it is `ENTITY_ID`-derived under another name, use that.
- The `challenge`/`verify` endpoints scope to the configured demo entity (single-entity demo), matching the rest of the API.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/onboardingRoute.test.ts`
Expected: PASS (3 tests). Replace the inline `require(...)` in the test with a top-level `import { normalizeSuiAddress } from '@mysten/sui/utils'` if the project's lint forbids `require`.

- [ ] **Step 5: Run the full api suite**

Run: `cd services/api && npx vitest run && npx tsc --noEmit`
Expected: all green (prior 167 + new tests), tsc 0 errors.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/http/routes.ts services/api/test/onboardingRoute.test.ts
git commit -m "feat(onboarding): GET /onboarding/:id + challenge + verify endpoints"
```

---

### Task 7: Web API types + endpoints + useOnboardingData

**Files:**
- Modify: `web/src/api/types.ts` (add DTOs)
- Modify: `web/src/api/endpoints.ts` (add 3 calls)
- Create: `web/src/data/useOnboardingData.ts`
- Test: `web/src/data/useOnboardingData.test.ts`

**Interfaces:**
- Produces (types):
  ```ts
  export interface OnboardingSourceDTO { wallet: string; eventCount: number; isDemoOwned: boolean; ownership: { verified: boolean; verifiedAt?: number } }
  export interface OnboardingDTO {
    entity: { id: string; displayName: string; meta: { functionalCurrency: string; reportingCurrency: string; fiscalCalendar: string; timezone: string } | null };
    sources: OnboardingSourceDTO[];
    unlistedVerified: { wallet: string; verifiedAt: number }[];
  }
  export interface ChallengeDTO { nonce: string; message: string; expiresAt: number; wallet: string }
  export interface VerifyResultDTO { verdict: 'VERIFIED'; attestation: { wallet: string; verifiedAt: number; verifier: string; templateVersion: string } }
  ```
- Produces (endpoints): `getOnboarding(entityId): Promise<OnboardingDTO>`, `postOnboardingChallenge(wallet): Promise<ChallengeDTO>`, `postOnboardingVerify(body): Promise<VerifyResultDTO>`.
- Produces (hook): `useOnboardingData(entityId): { data?: OnboardingDTO; loading: boolean; error?: string; refetch(): Promise<void> }`.

- [ ] **Step 1: Add DTO types to `web/src/api/types.ts`**

Append the five interfaces above to `types.ts`.

- [ ] **Step 2: Add endpoints to `web/src/api/endpoints.ts`**

Match the existing fetch-helper style in that file (e.g. the same `getJson`/`postJson` wrapper `getPolicyActive` uses). Example shape — adapt to the file's actual helper:

```ts
import type { OnboardingDTO, ChallengeDTO, VerifyResultDTO } from './types';

export function getOnboarding(entityId: string): Promise<OnboardingDTO> {
  return getJson(`/onboarding/${encodeURIComponent(entityId)}`);
}
export function postOnboardingChallenge(wallet: string): Promise<ChallengeDTO> {
  return postJson('/onboarding/challenge', { wallet });
}
export function postOnboardingVerify(body: { wallet: string; nonce: string; signature: string; connectedAccount: string }): Promise<VerifyResultDTO> {
  return postJson('/onboarding/verify', body);
}
```

Read `endpoints.ts` first to use its real helper names (`getJson`/`postJson` may be named differently).

- [ ] **Step 3: Write the failing test (cross-key gate)**

```ts
// web/src/data/useOnboardingData.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useOnboardingData } from './useOnboardingData';
import * as endpoints from '../api/endpoints';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const dto = (id: string) => ({ entity: { id, displayName: id, meta: null }, sources: [], unlistedVerified: [] });

beforeEach(() => vi.restoreAllMocks());

describe('useOnboardingData', () => {
  it('exposes data for the current entity only (cross-key gate)', async () => {
    const dA = deferred<ReturnType<typeof dto>>();
    const dB = deferred<ReturnType<typeof dto>>();
    const spy = vi.spyOn(endpoints, 'getOnboarding')
      .mockImplementationOnce(() => dA.promise as never)
      .mockImplementationOnce(() => dB.promise as never);

    const { result, rerender } = renderHook(({ id }) => useOnboardingData(id), { initialProps: { id: 'A' } });
    rerender({ id: 'B' });          // switch entity before A resolves
    dA.resolve(dto('A'));            // late A response must NOT surface
    dB.resolve(dto('B'));
    await waitFor(() => expect(result.current.data?.entity.id).toBe('B'));
    expect(result.current.data?.entity.id).not.toBe('A');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd web && npx vitest run src/data/useOnboardingData.test.ts`
Expected: FAIL — cannot find `useOnboardingData`.

- [ ] **Step 5: Implement `useOnboardingData.ts`** (mirror `usePolicyData` render-time gate)

```ts
// web/src/data/useOnboardingData.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnboardingDTO } from '../api/types';
import { getOnboarding } from '../api/endpoints';

interface FetchedState { entityId: string; value?: OnboardingDTO; error?: string }

export function useOnboardingData(entityId: string) {
  const [state, setState] = useState<FetchedState>(() => ({ entityId }));
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!entityId) return;
    const captured = entityId;
    const gen = ++genRef.current;
    setLoading(true);
    setState((prev) => ({ ...prev, error: undefined }));
    try {
      const value = await getOnboarding(captured);
      if (gen === genRef.current) setState({ entityId: captured, value });
    } catch (e) {
      if (gen === genRef.current) setState({ entityId: captured, error: (e as Error).message });
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Render-time cross-key gate: expose only data fetched FOR the current entity.
  const data = state.entityId === entityId ? state.value : undefined;
  const error = state.entityId === entityId ? state.error : undefined;
  return { data, loading, error, refetch };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && npx vitest run src/data/useOnboardingData.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/types.ts web/src/api/endpoints.ts web/src/data/useOnboardingData.ts web/src/data/useOnboardingData.test.ts
git commit -m "feat(onboarding/web): DTOs, endpoints, useOnboardingData (cross-key gate)"
```

---

### Task 8: usePersonalWalletOwnership (sign + verify flow)

**Files:**
- Create: `web/src/data/usePersonalWalletOwnership.ts`
- Test: `web/src/data/usePersonalWalletOwnership.test.ts`

**Interfaces:**
- Consumes: `useDAppKit`, `useCurrentAccount` (`@mysten/dapp-kit-react`); `postOnboardingChallenge`, `postOnboardingVerify`.
- Produces: `usePersonalWalletOwnership()` →
  ```ts
  {
    account: { address: string } | null;
    status: 'idle' | 'awaiting-signature' | 'verifying' | 'verified' | 'error';
    errorCode?: 'CHALLENGE_INVALID' | 'ADDRESS_MISMATCH' | 'BAD_SIGNATURE' | string;
    verify(wallet: string): Promise<void>;   // runs challenge → sign(message bytes) → verify
    reset(): void;
  }
  ```

Flow inside `verify(wallet)`: `status='awaiting-signature'` → `postOnboardingChallenge(wallet)` → `const { signature } = await dAppKit.signPersonalMessage(new TextEncoder().encode(message))` → `status='verifying'` → `postOnboardingVerify({ wallet, nonce, signature, connectedAccount: account.address })` → `status='verified'`. On any throw → `status='error'`, `errorCode` parsed from the error.

- [ ] **Step 1: Write the failing test** (mock dApp Kit + endpoints)

```ts
// web/src/data/usePersonalWalletOwnership.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const signPersonalMessage = vi.fn();
vi.mock('@mysten/dapp-kit-react', () => ({
  useDAppKit: () => ({ signPersonalMessage }),
  useCurrentAccount: () => ({ address: '0xabc' }),
}));
vi.mock('../api/endpoints', () => ({
  postOnboardingChallenge: vi.fn(),
  postOnboardingVerify: vi.fn(),
}));
import { usePersonalWalletOwnership } from './usePersonalWalletOwnership';
import { postOnboardingChallenge, postOnboardingVerify } from '../api/endpoints';

beforeEach(() => vi.clearAllMocks());

describe('usePersonalWalletOwnership', () => {
  it('runs challenge → sign → verify and lands on verified', async () => {
    (postOnboardingChallenge as ReturnType<typeof vi.fn>).mockResolvedValue({ nonce: 'n', message: 'MSG', expiresAt: 1, wallet: '0xabc' });
    signPersonalMessage.mockResolvedValue({ bytes: 'b64', signature: 'sigb64' });
    (postOnboardingVerify as ReturnType<typeof vi.fn>).mockResolvedValue({ verdict: 'VERIFIED', attestation: {} });

    const { result } = renderHook(() => usePersonalWalletOwnership());
    await act(async () => { await result.current.verify('0xabc'); });
    await waitFor(() => expect(result.current.status).toBe('verified'));
    expect(signPersonalMessage).toHaveBeenCalledWith(new TextEncoder().encode('MSG'));
    expect(postOnboardingVerify).toHaveBeenCalledWith({ wallet: '0xabc', nonce: 'n', signature: 'sigb64', connectedAccount: '0xabc' });
  });

  it('maps a verify failure to error status + errorCode', async () => {
    (postOnboardingChallenge as ReturnType<typeof vi.fn>).mockResolvedValue({ nonce: 'n', message: 'MSG', expiresAt: 1, wallet: '0xabc' });
    signPersonalMessage.mockResolvedValue({ bytes: 'b64', signature: 'sigb64' });
    (postOnboardingVerify as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ADDRESS_MISMATCH: nope'));

    const { result } = renderHook(() => usePersonalWalletOwnership());
    await act(async () => { await result.current.verify('0xabc'); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorCode).toContain('ADDRESS_MISMATCH');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/data/usePersonalWalletOwnership.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `usePersonalWalletOwnership.ts`**

```ts
// web/src/data/usePersonalWalletOwnership.ts
import { useCallback, useState } from 'react';
import { useDAppKit, useCurrentAccount } from '@mysten/dapp-kit-react';
import { postOnboardingChallenge, postOnboardingVerify } from '../api/endpoints';

type Status = 'idle' | 'awaiting-signature' | 'verifying' | 'verified' | 'error';

export function usePersonalWalletOwnership() {
  const dAppKit = useDAppKit();
  const account = useCurrentAccount();
  const [status, setStatus] = useState<Status>('idle');
  const [errorCode, setErrorCode] = useState<string | undefined>();

  const verify = useCallback(async (wallet: string) => {
    setErrorCode(undefined);
    try {
      setStatus('awaiting-signature');
      const { nonce, message } = await postOnboardingChallenge(wallet);
      const { signature } = await dAppKit.signPersonalMessage(new TextEncoder().encode(message));
      setStatus('verifying');
      await postOnboardingVerify({ wallet, nonce, signature, connectedAccount: account?.address ?? wallet });
      setStatus('verified');
    } catch (e) {
      setErrorCode((e as Error).message);
      setStatus('error');
    }
  }, [dAppKit, account]);

  const reset = useCallback(() => { setStatus('idle'); setErrorCode(undefined); }, []);

  return { account: account ? { address: account.address } : null, status, errorCode, verify, reset };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/data/usePersonalWalletOwnership.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/data/usePersonalWalletOwnership.ts web/src/data/usePersonalWalletOwnership.test.ts
git commit -m "feat(onboarding/web): usePersonalWalletOwnership sign+verify flow"
```

---

### Task 9: OnboardingWorkspace UI + route + registry

**Files:**
- Create: `web/src/workspaces/onboarding/EntitySummaryCard.tsx`
- Create: `web/src/workspaces/onboarding/SourceTable.tsx`
- Create: `web/src/workspaces/onboarding/OnboardingWorkspace.tsx`
- Create: `web/src/workspaces/onboarding/onboarding.css`
- Modify: `web/src/App.tsx` (import + route)
- Modify: `web/src/app/workspaces.ts` (`onboarding` status `soon` → `ready`)
- Test: `web/src/workspaces/onboarding/OnboardingWorkspace.test.tsx`

**Interfaces:**
- Consumes: `useOnboardingData`, `usePersonalWalletOwnership`, `useEntityCtx`, `ConnectButton` (`@mysten/dapp-kit-react/ui`), shared `Table`/`Badge` UI primitives, DTO types.

Visual law (spec §9): reuse `.policy-workspace`-style shell; `EntitySummaryCard` uses `.policy-defrow` label/value rows; `SourceTable` uses the shared `Table` component with `.td--mono` for wallet (middle-truncate `0x1a2b…9f0c` + `title` full + copy-on-click); UNVERIFIED badge `--ink-soft`, VERIFIED badge `--credit` green (NEVER `--aqua`); "verified (unlisted)" rows appended below with green badge + `--ink-soft` "unlisted" tag. Per-row verify state machine: `idle → connecting → awaiting-signature → verifying → VERIFIED | error`. Map error codes to inline messages: `CHALLENGE_INVALID`→"Challenge expired, retry", `ADDRESS_MISMATCH`→"Connected wallet ≠ this source", `BAD_SIGNATURE`→"Signature invalid".

- [ ] **Step 1: Read references**

Read `web/src/workspaces/policy/PolicyWorkspace.tsx`, `PolicySummaryCard.tsx`, `CoaMappingTable.tsx`, `policy.css`, and `web/src/components/ui/Table.module.css` + the `Table`/`Badge` component APIs. Match their import style and class usage.

- [ ] **Step 2: Write the failing component test**

```tsx
// web/src/workspaces/onboarding/OnboardingWorkspace.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../app/EntityContext', () => ({ useEntityCtx: () => ({ entity: { id: 'acme:pilot-001' } }) }));
vi.mock('@mysten/dapp-kit-react/ui', () => ({ ConnectButton: () => <button>Connect</button> }));
vi.mock('../../data/usePersonalWalletOwnership', () => ({
  usePersonalWalletOwnership: () => ({ account: null, status: 'idle', verify: vi.fn(), reset: vi.fn() }),
}));
const data = {
  entity: { id: 'acme:pilot-001', displayName: 'Acme Pilot', meta: { functionalCurrency: 'USD', reportingCurrency: 'USD', fiscalCalendar: 'Jan–Dec', timezone: 'America/New_York' } },
  sources: [
    { wallet: '0xacmeTreasury', eventCount: 3, isDemoOwned: false, ownership: { verified: false } },
    { wallet: '0xdemoOwned', eventCount: 0, isDemoOwned: true, ownership: { verified: true, verifiedAt: 100 } },
  ],
  unlistedVerified: [],
};
vi.mock('../../data/useOnboardingData', () => ({ useOnboardingData: () => ({ data, loading: false, error: undefined, refetch: vi.fn() }) }));
import { OnboardingWorkspace } from './OnboardingWorkspace';

beforeEach(() => vi.clearAllMocks());

describe('OnboardingWorkspace', () => {
  it('renders entity meta and source rows with ownership badges', () => {
    render(<OnboardingWorkspace />);
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
    expect(screen.getByText(/UNVERIFIED/i)).toBeInTheDocument(); // unverified source
    expect(screen.getByText(/VERIFIED/i)).toBeInTheDocument();   // demo-owned verified
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/workspaces/onboarding/OnboardingWorkspace.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the components**

`EntitySummaryCard.tsx`:

```tsx
import type { OnboardingDTO } from '../../api/types';

export function EntitySummaryCard({ entity }: { entity: OnboardingDTO['entity'] }) {
  const m = entity.meta;
  return (
    <section className="ob-card">
      <h2 className="ob-card-title">{entity.displayName}</h2>
      <p className="ob-card-note">These settings drive downstream FX conversion and period close.</p>
      {m ? (
        <>
          <Row label="Functional currency" value={m.functionalCurrency} />
          <Row label="Reporting currency" value={m.reportingCurrency} />
          <Row label="Fiscal calendar" value={m.fiscalCalendar} />
          <Row label="Timezone" value={m.timezone} />
        </>
      ) : <p className="ob-bad">entity meta unavailable</p>}
    </section>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="ob-defrow">
      <span className="ob-defrow-label">{label}</span>
      <span className="ob-defrow-value">{value}</span>
    </div>
  );
}
```

`SourceTable.tsx` (truncate helper + per-row verify state):

```tsx
import { useState } from 'react';
import type { OnboardingDTO } from '../../api/types';
import { usePersonalWalletOwnership } from '../../data/usePersonalWalletOwnership';

function trunc(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
const ERR: Record<string, string> = {
  CHALLENGE_INVALID: 'Challenge expired, retry',
  ADDRESS_MISMATCH: 'Connected wallet ≠ this source',
  BAD_SIGNATURE: 'Signature invalid',
};
function errMsg(code?: string): string {
  if (!code) return 'Verification failed';
  const key = Object.keys(ERR).find((k) => code.includes(k));
  return key ? ERR[key] : 'Verification failed';
}

export function SourceTable({ data, onVerified }: { data: OnboardingDTO; onVerified(): void }) {
  const { account, status, errorCode, verify } = usePersonalWalletOwnership();
  const [activeWallet, setActiveWallet] = useState<string | null>(null);

  async function onVerify(wallet: string) {
    setActiveWallet(wallet);
    await verify(wallet);
    if (status !== 'error') onVerified();
  }

  return (
    <table className="ob-table">
      <thead><tr><th>Wallet source</th><th>Events</th><th>Ownership</th><th /></tr></thead>
      <tbody>
        {data.sources.map((s) => {
          const busy = activeWallet === s.wallet && (status === 'awaiting-signature' || status === 'verifying');
          const rowErr = activeWallet === s.wallet && status === 'error';
          return (
            <tr key={s.wallet}>
              <td className="td--mono" title={s.wallet} onClick={() => navigator.clipboard?.writeText(s.wallet)}>{trunc(s.wallet)}{s.isDemoOwned ? ' (you)' : ''}</td>
              <td>{s.eventCount}</td>
              <td>
                {s.ownership.verified
                  ? <span className="ob-badge ob-badge--verified">VERIFIED</span>
                  : <span className="ob-badge ob-badge--unverified">UNVERIFIED</span>}
              </td>
              <td>
                {!s.ownership.verified && (
                  account
                    ? <button disabled={busy} onClick={() => onVerify(s.wallet)}>{busy ? 'Signing…' : 'Verify ownership'}</button>
                    : <span className="ob-hint">Connect wallet to verify</span>
                )}
                {rowErr && <span className="ob-bad"> {errMsg(errorCode)}</span>}
              </td>
            </tr>
          );
        })}
        {data.unlistedVerified.map((u) => (
          <tr key={u.wallet}>
            <td className="td--mono" title={u.wallet}>{trunc(u.wallet)}</td>
            <td>—</td>
            <td><span className="ob-badge ob-badge--verified">VERIFIED</span> <span className="ob-tag">unlisted</span></td>
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`OnboardingWorkspace.tsx`:

```tsx
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { useEntityCtx } from '../../app/EntityContext';
import { useOnboardingData } from '../../data/useOnboardingData';
import { EntitySummaryCard } from './EntitySummaryCard';
import { SourceTable } from './SourceTable';
import './onboarding.css';

export function OnboardingWorkspace() {
  const { entity } = useEntityCtx();
  const { data, loading, error, refetch } = useOnboardingData(entity?.id ?? '');

  if (loading && !data) return <div className="ob-workspace"><p>Loading onboarding…</p></div>;
  if (error || !data) return <div className="ob-workspace"><p className="ob-bad">onboarding unavailable{error ? `: ${error}` : ''}</p></div>;

  return (
    <div className="ob-workspace">
      <div className="ob-toolbar"><ConnectButton /></div>
      <EntitySummaryCard entity={data.entity} />
      <SourceTable data={data} onVerified={() => void refetch()} />
    </div>
  );
}
```

`onboarding.css` (reuse tokens; mirror `policy.css`):

```css
.ob-workspace { display: flex; flex-direction: column; gap: var(--space-4); max-width: 1200px; margin: 0 auto; }
.ob-toolbar { display: flex; justify-content: flex-end; }
.ob-card { background: var(--paper-card); border: 1px solid var(--hairline); border-radius: var(--radius-md); padding: var(--space-4); }
.ob-card-title { margin: 0 0 var(--space-1); }
.ob-card-note { color: var(--ink-soft); font-size: 0.85em; margin: 0 0 var(--space-3); }
.ob-defrow { display: flex; align-items: center; gap: var(--space-2); padding: 4px 0; flex-wrap: wrap; }
.ob-defrow-label { min-width: 220px; text-transform: uppercase; font-size: 0.78em; letter-spacing: 0.04em; color: var(--ink-soft); }
.ob-defrow-value { font-size: 0.92em; }
.ob-table { width: 100%; border-collapse: collapse; }
.ob-table th, .ob-table td { text-align: left; padding: var(--space-2); border-bottom: 1px solid var(--hairline); }
.ob-badge { font-size: 0.72em; padding: 2px 8px; border-radius: 999px; border: 1px solid; }
.ob-badge--unverified { color: var(--ink-soft); border-color: color-mix(in srgb, var(--ink-soft) 40%, transparent); }
.ob-badge--verified { color: var(--credit); border-color: color-mix(in srgb, var(--credit) 40%, transparent); background: color-mix(in srgb, var(--credit) 10%, var(--paper-card)); }
.ob-tag { font-size: 0.7em; color: var(--ink-soft); }
.ob-hint { font-size: 0.8em; color: var(--ink-soft); }
.ob-bad { color: var(--debit); }
```

Note: confirm token names (`--paper-card`, `--hairline`, `--radius-md`, `--ink-soft`, `--credit`, `--debit`, `--space-*`) against `tokens.css`; use the exact names that exist (Task 1 of prior workspaces established `--s-N` aliases — verify and match).

- [ ] **Step 5: Wire the route + registry**

In `web/src/App.tsx`, add import and route:

```tsx
import { OnboardingWorkspace } from './workspaces/onboarding/OnboardingWorkspace';
// ...inside WorkspaceContent, alongside the others:
  if (activeWorkspace === 'onboarding') return <OnboardingWorkspace />;
```

In `web/src/app/workspaces.ts`, flip status:

```ts
  { id: 'onboarding',     label: 'Onboarding',     icon: '🚢', status: 'ready' },
```

- [ ] **Step 6: Run test + build**

Run: `cd web && npx vitest run src/workspaces/onboarding/OnboardingWorkspace.test.tsx`
Expected: PASS.

Run: `cd web && npm run build`
Expected: build succeeds, 0 TS errors (build runs the vite tsc that catches what `tsc --noEmit` on the app tsconfig misses).

- [ ] **Step 7: Commit**

```bash
git add web/src/workspaces/onboarding web/src/App.tsx web/src/app/workspaces.ts
git commit -m "feat(onboarding/web): OnboardingWorkspace UI + route + registry ready"
```

---

### Task 10: Monkey testing + full-suite gate

**Files:**
- Create: `services/api/test/monkey.onboarding.test.ts`
- (No production changes unless a monkey case finds a real bug — if so, fix in the owning file and note it.)

**Interfaces:**
- Consumes: everything above (route-level via `app.inject`, plus real keypairs).

- [ ] **Step 1: Write monkey tests (extreme / adversarial)**

```ts
// services/api/test/monkey.onboarding.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { openDb } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { registerRoutes } from '../src/http/routes.js';
import { loadConfig } from '../src/config.js';
import { encodeOwnershipMessage } from '../src/onboarding/message.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';

const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'https://grpc', ANCHOR_PACKAGE_ID: '0xpkg',
  ANCHOR_ORIGINAL_PACKAGE_ID: '0xpkg', ENTITY_ID: 'acme:pilot-001',
  ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm1', AI_MODEL_COPILOT: 'm2',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});
const stub: GeminiClient = { async generateJson() { return {} as never; } };
const E = 'acme:pilot-001';
let app: FastifyInstance;
beforeEach(async () => {
  const db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
  app = Fastify();
  registerRoutes(app, { db, cfg, classifyClient: stub, copilotClient: stub, anchorAdapter: null as never, mutex: { run: (_k: string, fn: () => Promise<never>) => fn() } } as never);
  await app.ready();
});

async function freshSig() {
  const kp = new Ed25519Keypair();
  const wallet = kp.toSuiAddress();
  const { nonce, expiresAt } = (await app.inject({ method: 'POST', url: '/onboarding/challenge', payload: { wallet } })).json();
  const bytes = encodeOwnershipMessage({ entityId: E, wallet, nonce, expiresAt });
  const { signature } = await kp.signPersonalMessage(bytes);
  return { wallet, nonce, signature };
}

describe('monkey: onboarding verify', () => {
  it('replay of the same signature twice → 2nd is 422', async () => {
    const { wallet, nonce, signature } = await freshSig();
    const first = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet, nonce, signature, connectedAccount: wallet } });
    const second = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet, nonce, signature, connectedAccount: wallet } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(422);
  });

  it('cross-wallet nonce swap: A nonce + B signature → 422, no attestation', async () => {
    const a = await freshSig();
    const b = await freshSig();
    const res = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet: a.wallet, nonce: a.nonce, signature: b.signature, connectedAccount: a.wallet } });
    expect(res.statusCode).toBe(422);
  });

  it('forged message: client cannot influence verification (no message field accepted)', async () => {
    const { wallet, nonce, signature } = await freshSig();
    // attacker also passes a bogus "message" — server must ignore it and still verify against rebuilt bytes
    const res = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet, nonce, signature, connectedAccount: wallet, message: 'I OWN EVERYTHING' } });
    expect(res.statusCode).toBe(200); // still valid because server rebuilds; bogus field ignored
  });

  it('garbage signature → 422 BAD_SIGNATURE not 500', async () => {
    const { wallet, nonce } = await freshSig();
    const res = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet, nonce, signature: 'not-base64-!!', connectedAccount: wallet } });
    expect(res.statusCode).toBe(422);
  });

  it('oversized junk fields do not crash the server', async () => {
    const big = 'x'.repeat(100_000);
    const res = await app.inject({ method: 'POST', url: '/onboarding/verify', payload: { wallet: big, nonce: big, signature: big, connectedAccount: big } });
    expect([400, 422]).toContain(res.statusCode);
  });
});
```

- [ ] **Step 2: Run monkey tests**

Run: `cd services/api && npx vitest run test/monkey.onboarding.test.ts`
Expected: PASS (5 tests). If any fails revealing a real bug (e.g. a 500 instead of 422), fix the owning handler/function and re-run.

- [ ] **Step 3: Full suite gate (api + web)**

Run:
```bash
cd services/api && npx vitest run && npx tsc --noEmit
cd ../../web && npx vitest run && npm run build
```
Expected: api all green + tsc 0; web all green + build 0.

- [ ] **Step 4: Commit**

```bash
git add services/api/test/monkey.onboarding.test.ts
git commit -m "test(onboarding): monkey — replay, nonce swap, forged message, garbage, oversized"
```

- [ ] **Step 5: Mandatory dual-review**

`verify.ts` is an auth path. Run the **codex dual-review** (dev-rules `/dual-review`) over the onboarding diff before declaring done. Adjudicate findings: real fail-closed/correctness bugs → fix; design-intent/deferred items → record in spec §1.1, don't expand scope.

---

## Self-Review (plan vs spec)

**Spec coverage:**
- §1 scope (read-only display + ownership verify) → Tasks 1-9. ✅
- §1.1 deferred → not implemented (correct); `initiated_by` column present (Task 1). ✅
- §2 backend endpoints/tables/entity-meta-constants → Tasks 1,2,6. ✅
- §3 data flow (challenge→sign→verify, server rebuild, atomic) → Tasks 4,5,8. ✅
- §4 components (message/sources/challenge/verify/store + FE hooks/components) → Tasks 1-3,5,7,8,9. ✅
- §5 error handling + §5.1 no-downstream-gate (display-only; not implemented as a gate, correct) → Tasks 5,6,9 (error codes, badges). ✅
- §6 red team (replay/spoof/swap/injection/forgery) → Task 10 monkey + Task 5 unit. ✅
- §7 testing (byte-golden, real-sig, cross-key, monkey, dual-review) → Tasks 2,5,7,10. ✅
- §8 out of scope → respected (no on-chain tx, no zkLogin login, no entity mutation). ✅
- §9 visual/layout (tokens, reuse primitives, dapp-kit theme, verify-state) → Task 9. ✅

**Type consistency:** `AttestationRow`/`ChallengeRow` (Task 1) used verbatim in Tasks 5,6; `OnboardingDTO`/`ChallengeDTO`/`VerifyResultDTO` (Task 7) used in Tasks 8,9; `DerivedSource` (Task 3) used in Task 6. Hook return shapes consistent.

**Known confirm-before-coding points (flagged inline in tasks):**
- `eventStore` `insertEvent`/`EventRow` exact field names (Task 3 Step 1 note).
- `cfg.entityId` property name on `ApiConfig` (Task 6 note).
- `endpoints.ts` helper names `getJson`/`postJson` (Task 7 note).
- `@mysten/sui/keypairs/secp256k1` import path (Task 5 note).
- `tokens.css` exact token names incl. `--s-N` aliases (Task 9 note).
- `normalizeSuiAddress` behavior on non-hex demo strings (Task 4 note) — use real-ish hex in tests.
