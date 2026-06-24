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
- **Re-attestation / expiry / revocation** of ownership proofs (wallet control can change — key handoff, multisig signer change); this round's proof is point-in-time only (CPA review).
- **Ownership-gating of downstream accounting** (block posting/recon/close on unverified sources) — see §5.1; production-required, deferred.
- **Maker-checker SoD** on verification (separate initiator vs approver). The `initiated_by` column is added now (§2 DB) so this upgrade won't need to alter the append-only table; the approver half is deferred.
- **Demo-seed guard**: `deriveSources` must confirm each wallet maps to a single entity in the seed data, so the read-only view doesn't accidentally surface a cross-entity overlap (which would need an allocation rule we haven't built).

This matches the established pattern of the prior two soon slots (Export, Policy): additive read-only backend + one narrow write, fail-closed, safe-state badge, no aqua.

## 2. Architecture

Three layers, additive only (no existing behavior changed):

### Frontend
- Wire dApp Kit providers in `main.tsx`, in this exact nesting (per sui-architect review — `SuiClientProvider`/`WalletProvider` alone will not mount):
  ```tsx
  const { networkConfig } = createNetworkConfig({ testnet: { url: getFullnodeUrl('testnet') } });
  <QueryClientProvider client={queryClient}>
    <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
      <WalletProvider autoConnect>{app}</WalletProvider>
    </SuiClientProvider>
  </QueryClientProvider>
  ```
  TanStack `QueryClientProvider` + `createNetworkConfig` are required. Do NOT call `registerWallet` (that is the wallet-builder API; dApps rely on Wallet-Standard self-registration). Deps already present in `web/package.json` (`@mysten/dapp-kit-react ^2`, `@mysten/dapp-kit-core ^1.6`, `@mysten/sui ^2`); provider not yet mounted. Run the SDK compat-banner check before locking versions.
- `OnboardingWorkspace` → `EntitySummaryCard` (entity meta, read-only) + `SourceTable` (one row per derived wallet source: wallet address / ownership badge / Verify action). Note: `purpose` / `legal owner` / `GL dimension` are NOT in the event data — they belong to the deferred source-CRUD slice (§1.1); do not invent them. Show only what is derivable (wallet address, and optionally asset/coinType count from movements).
- Visual law inherited from Policy/Export: fail-closed, safe-state badge (UNVERIFIED is the safe default), no aqua, brass for emphasis.

### Backend (additive — 2 read endpoints, 1 write path)
- `GET /onboarding/:entityId` → entity meta + derived sources (each with current attestation state).
- `POST /onboarding/challenge` → issue single-use nonce bound to (entity, wallet).
- `POST /onboarding/verify` → verify signature server-side, persist attestation.

### DB (2 new tables, additive to schema.sql)
- `onboarding_challenge`: `(entity_id, wallet, nonce, expires_at, consumed_at NULL, created_at)`. Single-use (consume = atomic UPDATE guarded by `consumed_at IS NULL`), short TTL (5 min).
- `wallet_ownership_attestation`: append-only. `(id, entity_id, wallet, nonce, verifier, initiated_by, message_snapshot, template_version, connected_account, verified_at)`. Mirrors the existing disposition / `_log` append-only pattern. Columns and their rationale (all added now — CPA review: cheap as a column today, painful to backfill into an append-only table later):
  - `verifier` — **server-fixed constant** (never client-supplied, §6).
  - `initiated_by` — SoD maker field: the logged-in principal that initiated verification. Single-user demo writes a server constant placeholder, but the **column exists now** so a later auth/maker-checker upgrade doesn't have to alter the append-only table.
  - `message_snapshot` + `template_version` — the exact signed message text (or its template version) at verification time, so a future template change can't orphan old attestations' self-referential audit evidence.
  - `connected_account` — the dApp Kit connected account at signing time (may differ from `wallet` in multi-account wallets — kept as evidence).

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
  │    2. REBUILD message string from stored challenge fields (NOT from client message), encode UTF-8
  │    3. verifyPersonalMessageSignature(bytes, signature, { address: normalizeSuiAddress(wallet) })
  │         → returns a PublicKey; THROWS on bad signature OR address mismatch (binding is atomic, no manual ===)
  │    4. on throw → fail-closed, do NOT consume nonce (avoids DoS); map: bad sig → BAD_SIGNATURE, mismatch → ADDRESS_MISMATCH
  │    5. UPDATE consumed_at = now  (atomic single-use)
  │    6. INSERT wallet_ownership_attestation (verifier/initiated_by = server constants; message_snapshot/connected_account from context)
  ▼   → { verdict: 'VERIFIED', attestation }
```

**API correction (sui-architect blocker)**: use `verifyPersonalMessageSignature(message, signature, { address })` from `@mysten/sui/verify`. It returns a **PublicKey** (not an address) and **throws** when the signature is invalid OR the recovered address ≠ supplied `address` — binding is atomic, there is no top-level "recovered address" return and no manual `===`. Always run the address through `normalizeSuiAddress()` on both store and verify (0x-prefixed lowercase 32-byte).

**Encoding (sui-architect important)**: server rebuilds the exact UTF-8 string and passes `new TextEncoder().encode(message)` as raw `Uint8Array`. Do NOT manually add Sui personal-message intent bytes on either side — `signPersonalMessage` and `verifyPersonalMessageSignature` wrap the intent internally. Client returns `{ bytes (base64), signature (base64) }`; the BE **ignores the client `bytes` field** and trusts only `signature`. Pin newline style (`\n`, no trailing newline); the §7 golden test locks the exact byte sequence.

**Signature scheme**: accept ANY wallet scheme (Ed25519 / Secp256k1 / Secp256r1 / multisig / zkLogin) — `verifyPersonalMessageSignature` handles all and yields the correct address. No scheme allow-listing; zkLogin/Enoki/Passkey *as login methods* stay Phase 2 (§8), but a zkLogin-signed personal message still verifies if presented.

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
- `onboarding/verify.ts` — `verifyOwnership(db, {entityId, wallet, nonce, signature})`: transaction wrapping consume + attestation; delegates signature check to `verifyPersonalMessageSignature` from `@mysten/sui/verify` (sole SDK seam).
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
| malformed signature / verifyPersonalMessageSignature throws | 422 `BAD_SIGNATURE` (caught, not 500) |
| wallet not connected | Verify button disabled; prompt to connect |
| entityId switched mid-flight | render-stage cross-key gate drops stale data |
| any unknown | fail-closed = badge stays UNVERIFIED (never a false VERIFIED) |

**Core safety invariant**: UNVERIFIED is the default and is safe; VERIFIED appears only when a server attestation exists. The frontend never self-determines verified status.

### 5.1 Ownership does NOT gate downstream accounting (explicit demo stance — CPA review)

This round, ownership status is **display-only**: a source's transactions flow into events / reconciliation / close **regardless of whether its wallet ownership is VERIFIED**. The badge is evidence, not a gate.

- This is a deliberate demo scope decision, stated explicitly rather than left silent.
- **In production this must change**: an unverified source's holdings have no ownership evidence backing the existence/rights assertion, so a real system must gate posting/recon/close on verified ownership. Recorded as a deferred production requirement (§1.1).
- Ownership proof asserts **existence/rights** ("I control this wallet") at a point in time — it is NOT a completeness assertion ("all this wallet's activity is booked"); completeness depends on the deferred sync cursor/dedupe path. Demo narrative must not conflate the two.
- The UI shows `verified_at` so VERIFIED reads as a point-in-time proof, not a perpetual guarantee (no re-attestation/revocation this round — deferred).

## 6. Security (red team — auth path)

1. **Replay** (reuse captured signature) → nonce single-use (atomic `WHERE consumed_at IS NULL`) + TTL.
2. **Address spoofing** (sign with a different key, claim wallet X) → `verifyPersonalMessageSignature(..., { address })` recovers the public key, derives its Sui address, and throws unless it matches the supplied (normalized) `wallet`; server never trusts client-asserted address.
3. **Cross-wallet nonce swap** (get A's challenge, submit as B) → nonce bound to (wallet, entity) at issuance; verify checks stored nonce's wallet === claimed wallet.
4. **Message injection** (client supplies arbitrary message text) → server **rebuilds** message bytes from the stored challenge; signature is verified over server-rebuilt bytes, never over the client message string.
5. **Actor forgery / non-atomic write** (client sets verifier; or attestation written but nonce not consumed) → verifier is a server-fixed constant; consume-nonce + append-attestation are wrapped in a single transaction.

Encodes prior lessons: read/permission/state gates enforced on the backend (not UI-only); actor identity fields never accept client values.

## 7. Testing

- **Backend unit**: message template golden — lock the exact **byte sequence** (`TextEncoder().encode`), not just the string, incl. newline style (anti-drift: challenge/verify share one fn); issueChallenge rejects non-source wallet; verify failure paths each genuinely triggered (expired / consumed / mismatch / bad signature); atomic consume (concurrent double-verify on same nonce → only one succeeds); attestation append-only + verifier/initiated_by server-fixed; mismatch/bad-sig do NOT consume the nonce.
- **Real-signature test**: `@mysten/sui` `Ed25519Keypair` actually signs the rebuilt message → `verifyPersonalMessageSignature` passes; flip one byte → throws → `BAD_SIGNATURE`; sign with a different key but claim wallet X → throws on `{ address }` mismatch → `ADDRESS_MISMATCH` (cf. "fail paths must be really triggered, not type-aligned" lesson). Also test a non-Ed25519 (e.g. Secp256k1) signer verifies, confirming scheme-agnostic acceptance.
- **Frontend**: `useOnboardingData` cross-key gate (deferred-fetch mock; other-entity response arrives late and never surfaces); badge safe-state (no attestation → UNVERIFIED); Verify happy path (mock signPersonalMessage).
- **Monkey**: replay same signature twice (2nd → 422); cross-wallet nonce swap; client-supplied forged message string; excess sources; oversized nonce/address.
- **Mandatory**: verify is an auth path → run **codex dual-review** on completion (dev-rules). No Move changes; sui-code-review not involved.

## 8. Out of Scope / Non-Goals

- No on-chain transaction (ownership proof is an off-chain personal-message signature, not a chain write).
- No zkLogin / Enoki / Passkey (Phase 2, §13).
- No multi-entity, no entity/source mutation (see §1.1 deferred).

## 9. Visual / Layout (frontend-design review)

Reuse existing primitives — the codebase already provides what this workspace needs; do NOT re-roll them.

### Tokens & badge semantics (verified against `web/src/`)
- **UNVERIFIED badge → `--ink-soft`** (neutral safe default, mirrors the existing `badge--draft`). Do **NOT** use `--warn`/amber — amber = NEEDS_REVIEW (action-required), which would wrongly imply the user erred by not yet verifying.
- **VERIFIED badge → `--credit` (green)** — green is the existing "confirmed/passed" semantic (AUTO badge). **NEVER `--aqua`**: aqua is reserved EXCLUSIVELY for on-chain/blockchain semantics (`Badge.module.css` §8.1, ANCHORED). Ownership proof is off-chain (§8), so aqua would falsely signal an on-chain anchor. Brass is emphasis/version-chip only — weaker semantic than `--credit`; prefer green.

### Layout patterns (reuse)
- **Wallet address** → shared Table primitive's `.td--mono` (IBM Plex Mono + tabular-nums; `Table.module.css:52`, documented for hash addresses) + middle-truncate (`0x1a2b…9f0c`) + copy-on-click + `title` full address. Never dump 66 chars raw.
- **SourceTable** → built on the shared Table (`Table.module.css`); `.tableWrap` already has `overflow-x:auto` (line 8) → mobile RWD for free. Do not hand-roll a stacked layout.
- **EntitySummaryCard** → use PolicyWorkspace's `.policy-defrow` label/value row pattern (`workspaces/policy/policy.css:11`: uppercase `--ink-soft` label `min-width:220px` + value). Add one helper line noting these meta fields drive downstream FX conversion + period close (so the read-only card reads as load-bearing, not decorative).
- **Shell** → reuse `.policy-workspace` shell (flex-column, `gap:--space-4`, `max-width:1200px`, centered). EntitySummaryCard is visually subordinate (context); SourceTable is the primary action zone.

### dApp Kit theming (already wired — headline)
- The dApp Kit generic CSS vars (`--primary`, `--popover`, `--destructive`, `--radius`, `--ring`, …) are **already mapped to TallyMarina tokens in `tokens.css:77-93`**, theming the ConnectButton + its portaled popover/modal. **Do NOT add ad-hoc overrides.** After mounting `WalletProvider`, verify the popover/modal renders on-palette (a token rename would silently break it). Import dApp Kit's stylesheet; **acceptance item**: visual smoke-check of the connect modal (its internal font/spacing may not fully bend to the 6 mapped vars).

### Verify-state UI (was a gap — now specified)
SourceTable row Verify action is a small state machine; show explicit per-row feedback:
`idle → connecting (wallet) → awaiting-signature (button spinner, disabled) → verifying → VERIFIED | error(code → message)`.
Map error codes to human messages inline per-row: `CHALLENGE_INVALID` → "Challenge expired, retry"; `ADDRESS_MISMATCH` → "Connected wallet ≠ this source"; `BAD_SIGNATURE` → "Signature invalid". Distinguish "connect wallet first" (no account) from "verify" (account connected) prompts.
