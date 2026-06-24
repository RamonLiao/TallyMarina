# Onboarding Workspace — Design Spec

**Date**: 2026-06-24
**Phase**: 1 (last of three soon slots: export ✅ / policy ✅ / **onboarding**)
**Status**: design approved, pending implementation plan
**Source**: business-spec-v3 §4.1, workspace-shell-design §C3

## 1. Scope

Onboarding workspace surfaces the spec §4.1 "建立企業與連接資料來源" story, scoped this round to the genuinely Sui-native, demo-safe slice:

- **Read-only display** of the entity (functional currency, reporting currency, fiscal calendar, timezone — currently a single seeded demo entity) and its **connected wallet sources** (derived from `events.rawJson.wallet`, real data — there is no source table).
- **dApp Kit personal-message signature** proving wallet ownership, verified **server-side**, persisted as an **append-only attestation**. No private key is ever stored (spec §4.1 / §13 dApp Kit row).

### 1.1 Deferred (future upgrade — explicitly out of this round)

Recorded so a later chat can pick them up; do NOT implement now:

- Real entity creation (`POST /entities`), entity meta editing.
- Source CRUD: add/assign/remove AccountSource, legal owner / purpose / GL dimension assignment, CEX / custody / controlled-CSV sources (Post-pilot per §2.5).
- Historical backfill start-point + incremental sync frequency config.
- §4.1 acceptance items that need a real source lifecycle: "同來源不得重疊期間重複歸屬不同 entity", sync-retry dedupe of RawTransaction, cursor/version/error logging — these belong to the source-write path, not this read+attest slice.

This matches the established pattern of the prior two soon slots (Export, Policy): additive read-only backend + one narrow write, fail-closed, safe-state badge, no aqua.

## 2. Architecture

Three layers, additive only (no existing behavior changed):

### Frontend
- Wire dApp Kit providers in `main.tsx`: `SuiClientProvider` (testnet) + `WalletProvider`. Deps already present in `web/package.json` (`@mysten/dapp-kit-react ^2`, `@mysten/dapp-kit-core ^1.6`, `@mysten/sui ^2`); provider not yet mounted.
- `OnboardingWorkspace` → `EntitySummaryCard` (entity meta, read-only) + `SourceTable` (one row per derived wallet source: wallet address / ownership badge / Verify action). Note: `purpose` / `legal owner` / `GL dimension` are NOT in the event data — they belong to the deferred source-CRUD slice (§1.1); do not invent them. Show only what is derivable (wallet address, and optionally asset/coinType count from movements).
- Visual law inherited from Policy/Export: fail-closed, safe-state badge (UNVERIFIED is the safe default), no aqua, brass for emphasis.

### Backend (additive — 2 read endpoints, 1 write path)
- `GET /onboarding/:entityId` → entity meta + derived sources (each with current attestation state).
- `POST /onboarding/challenge` → issue single-use nonce bound to (entity, wallet).
- `POST /onboarding/verify` → verify signature server-side, persist attestation.

### DB (2 new tables, additive to schema.sql)
- `onboarding_challenge`: `(entity_id, wallet, nonce, expires_at, consumed_at NULL, created_at)`. Single-use (consume = atomic UPDATE guarded by `consumed_at IS NULL`), short TTL (5 min).
- `wallet_ownership_attestation`: append-only. `(id, entity_id, wallet, nonce, verifier, verified_at)`. `verifier` is a **server-fixed constant** (never client-supplied — see §6 lesson). Mirrors the existing disposition / `_log` append-only pattern.

## 3. Data Flow

```
[FE] user clicks "Verify ownership" on a SourceTable row
  │   dApp Kit: connect wallet → connectedAddress
  ▼
POST /onboarding/challenge { entityId, wallet }
  │   BE: assert wallet ∈ deriveSources(entityId)  (else 422 fail-closed)
  │       generate nonce (crypto random); INSERT onboarding_challenge
  │       (entityId, wallet, nonce, expiresAt = now + 5min, consumed_at = NULL)
  ▼   → { nonce, message, expiresAt }   message = server-built template
[FE] dApp Kit signPersonalMessage(messageBytes)  ← user signs in wallet
  ▼
POST /onboarding/verify { entityId, wallet, nonce, signature }
  │   BE, in a SINGLE transaction:
  │    1. SELECT challenge WHERE entity+wallet+nonce AND consumed_at IS NULL AND expiresAt > now → else fail-closed
  │    2. REBUILD message bytes from stored challenge fields (NOT from client message)
  │    3. verifyPersonalMessage(bytes, signature) → recovered address
  │    4. recovered === wallet ? else fail-closed (do NOT consume nonce — avoids DoS)
  │    5. UPDATE consumed_at = now  (atomic single-use)
  │    6. INSERT wallet_ownership_attestation (verifier = server constant)
  ▼   → { verdict: 'VERIFIED', attestation }
```

### Message template (domain-bound, anti blind-sign reuse)
```
Subledger ownership proof
entity: <entityId>
wallet: <wallet>
nonce: <nonce>
expires: <ISO8601>
```
Built by a single function imported by both challenge and verify (anti-drift chokepoint, cf. policyConstants lesson).

## 4. Components (single-responsibility, independently testable)

### Backend
- `onboarding/message.ts` — `buildOwnershipMessage({entityId, wallet, nonce, expiresAt}): string`. **Sole** source of the template; imported by challenge + verify.
- `onboarding/sources.ts` — `deriveSources(db, entityId)`: distinct wallet from events, reusing movement.ts parsing (no rewrite).
- `onboarding/challenge.ts` — `issueChallenge(db, entityId, wallet)`: assert wallet ∈ sources, gen nonce, persist, return `{nonce, message, expiresAt}`.
- `onboarding/verify.ts` — `verifyOwnership(db, {entityId, wallet, nonce, signature})`: transaction wrapping consume + attestation; delegates signature check to `@mysten/sui` `verifyPersonalMessage` (sole SDK seam).
- `store/onboardingStore.ts` — challenge CRUD + attestation append/list (mirrors dispositionStore).
- routes: 3 thin handlers over the above.

### Frontend
- `usePersonalWalletOwnership` — dApp Kit `useSignPersonalMessage` + `useCurrentAccount`.
- `useOnboardingData(entityId)` — fetch `GET /onboarding/:entityId`; stores `{entityId, value}` pair and exposes value only when `state.entityId === entityId` (render-stage cross-key gate, cf. Period Close stale lesson).
- `OnboardingWorkspace` → `EntitySummaryCard` + `SourceTable`.
- `main.tsx` — mount `SuiClientProvider` (testnet) + `WalletProvider`.

## 5. Error Handling / Fail-Closed

| Situation | Behavior |
|---|---|
| wallet ∉ entity sources | challenge 422; UI offers no Verify |
| nonce expired / consumed / missing | verify 422 `CHALLENGE_INVALID`; badge stays UNVERIFIED |
| recovered address ≠ wallet | verify 422 `ADDRESS_MISMATCH`; **nonce NOT consumed** |
| malformed signature / verifyPersonalMessage throws | 422 `BAD_SIGNATURE` (caught, not 500) |
| wallet not connected | Verify button disabled; prompt to connect |
| entityId switched mid-flight | render-stage cross-key gate drops stale data |
| any unknown | fail-closed = badge stays UNVERIFIED (never a false VERIFIED) |

**Core safety invariant**: UNVERIFIED is the default and is safe; VERIFIED appears only when a server attestation exists. The frontend never self-determines verified status.

## 6. Security (red team — auth path)

1. **Replay** (reuse captured signature) → nonce single-use (atomic `WHERE consumed_at IS NULL`) + TTL.
2. **Address spoofing** (sign with a different key, claim wallet X) → `verifyPersonalMessage` recovers public key → derived Sui address must `=== wallet`; server never trusts client-asserted address.
3. **Cross-wallet nonce swap** (get A's challenge, submit as B) → nonce bound to (wallet, entity) at issuance; verify checks stored nonce's wallet === claimed wallet.
4. **Message injection** (client supplies arbitrary message text) → server **rebuilds** message bytes from the stored challenge; signature is verified over server-rebuilt bytes, never over the client message string.
5. **Actor forgery / non-atomic write** (client sets verifier; or attestation written but nonce not consumed) → verifier is a server-fixed constant; consume-nonce + append-attestation are wrapped in a single transaction.

Encodes prior lessons: read/permission/state gates enforced on the backend (not UI-only); actor identity fields never accept client values.

## 7. Testing

- **Backend unit**: message template golden (anti-drift: challenge/verify share one fn); issueChallenge rejects non-source wallet; verify failure paths each genuinely triggered (expired / consumed / mismatch / bad signature); atomic consume (concurrent double-verify on same nonce → only one succeeds); attestation append-only + verifier server-fixed.
- **Real-signature test**: `@mysten/sui` `Ed25519Keypair` actually signs the message → verify passes; flip one byte → `ADDRESS_MISMATCH` / `BAD_SIGNATURE` (cf. "fail paths must be really triggered, not type-aligned" lesson).
- **Frontend**: `useOnboardingData` cross-key gate (deferred-fetch mock; other-entity response arrives late and never surfaces); badge safe-state (no attestation → UNVERIFIED); Verify happy path (mock signPersonalMessage).
- **Monkey**: replay same signature twice (2nd → 422); cross-wallet nonce swap; client-supplied forged message string; excess sources; oversized nonce/address.
- **Mandatory**: verify is an auth path → run **codex dual-review** on completion (dev-rules). No Move changes; sui-code-review not involved.

## 8. Out of Scope / Non-Goals

- No on-chain transaction (ownership proof is an off-chain personal-message signature, not a chain write).
- No zkLogin / Enoki / Passkey (Phase 2, §13).
- No multi-entity, no entity/source mutation (see §1.1 deferred).
