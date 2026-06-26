# Sui Agentic Subledger — Human Demo Dry-Run Script

**Task 11: Layer 3 E2E—Human-Facing Dry-Run for Real Testnet Wallet**

This is a human walkthrough of the full close-the-period flow, end-to-end, with a real Sui testnet wallet. No test code; pure documentation with copy-pasteable commands and per-step visual landmarks.

---

## Prerequisites

### 1. Funded Testnet Wallet & AnchorCap Ownership

You need a testnet wallet that **owns the real AnchorCap**. The cap's object ID is:

```
0x266e7c8ea0b27ad52080074c9f6c1f73ec8a6ea9dd9a68d310b7cf56262dfba9
```

If you don't have this cap, ask the team to transfer it to your wallet address via:

```bash
sui client transfer \
  --to <your-wallet-address> \
  --object-id 0x266e7c8ea0b27ad52080074c9f6c1f73ec8a6ea9dd9a68d310b7cf56262dfba9 \
  --gas-budget 10000000
```

Verify ownership by querying the chain:

```bash
sui client objects --filter-by-type 0x2::transfer_policy::TransferPolicy | grep 0x266e7c8e
```

### 2. Environment Setup

Set these in `services/api/.env` (the API server reads them):

```bash
# Required to own & sign the AnchorCap during anchor step
SUI_PK=<your-testnet-private-key>

# Classify endpoint reads this (Gemini)
GEMINI_API_KEY=<your-gemini-api-key>

# All must be set (check they're already in .env)
SUI_NETWORK=testnet
SUI_GRPC_URL=https://grpc.testnet.sui.io
ENTITY_DEMO_WALLET=0x0000000000000000000000000000000000000000000000000000000000000abc
```

**Verify these are set:**

```bash
cd services/api && grep -E "^(SUI_|GEMINI_|ENTITY_)" .env
```

### 3. Reset Persistent Database

The persistent SQLite DB at `services/api/data/` remembers which periods have been anchored. Before a clean demo run, **delete it**:

```bash
rm -f services/api/data/*.db
```

This is **different** from the test harness `SEQ_MISMATCH` error (which is in-memory). The persistent DB error is `409 ALREADY_ANCHORED` — if you see it on re-run, delete the DB.

### 4. Testnet SUI Coin

Your testnet wallet must hold at least 0.1 SUI to pay gas for the anchor transaction. Request testnet faucet SUI:

```bash
curl --location --request POST 'https://faucet.testnet.sui.io/gas' \
  --header 'Content-Type: application/json' \
  --data-raw '{ "FixedAmountRequest": { "recipient": "<your-wallet-address>" } }'
```

---

## Launch

Open **two terminal tabs** (or tmux windows):

### Tab 1: API Server

```bash
cd services/api
npm start
```

Expected output: logs mention `Listening on port 8787` and `gRPC tx submit`. The server will:
- Load persistent SQLite DB from `data/` dir.
- Boot anchor-service with your `SUI_PK`.
- Wait for HTTP requests on `:8787`.

### Tab 2: Web Server

```bash
cd web
npm run dev
```

Expected output: logs mention `VITE v5.x.x` and `Local: http://localhost:5173`. Open your browser:

```
http://localhost:5173
```

You'll see the **Sui Agentic Subledger** home page (navy header, workspace nav on left, entity picker in top-right).

---

## Steps: Close-the-Period Flow

Each step below shows the **Action** (what to click/do), **Expected functional result** (backend confirms), and **Expected visual landmark** (CSS class / color / badge you'll see).

### Step 1: Navigate to Demo Entity and Ingest Tab

**Action:**
- Top-right entity picker: click dropdown, select **"ACME Pilot 001"** (the fixture entity).
- Left sidebar: click **"Close"** (navy underline + brass text).
- The main panel shows 5 step rails: `1. Ingest`, `2. Classify`, …, `5. Anchor`.
- Click the **"Ingest"** rail heading or the `>` icon to expand Step 1.

**Expected functional result:**
- Browser loads the real ingest data for the entity's period (3 sample events).
- API `GET /entities/{entityId}/period` returns status `OPEN`.

**Expected visual landmark:**
- Step 1 **Ingest** tab is active (top of the Close workspace).
- A small brass **pill button** reads "Ingest" (`.btn-primary` class, rounded—not a grey square).
- The rail shows small numbered boxes `1 2 3 4 5`; box `1` is highlighted.

---

### Step 2: Review Ingest Data & Click Classify

**Action:**
- Scroll down in the Ingest panel. See 3 rows of ingest events (dates, amounts, descriptions).
- Click the brass **"Classify"** CTA button at the bottom of the Ingest section.

**Expected functional result:**
- Backend calls `POST /entities/{entityId}/period/classify` with the 3 events.
- Gemini API scores each event as high/medium/low confidence (you'll see live requests in API logs).
- DB stores the classified events.
- API returns 200 with classifications embedded.

**Expected visual landmark:**
- The **Classify** button pulses or shows a loading spinner (subtle brass animation).
- A progress bar labeled "AI Confidence" animates from 0% to ~95% (depends on Gemini scoring).
- Once complete, the panel slides or fades to show the **Review** step results below.

---

### Step 3: Review & Decide on Exceptions

**Action:**
- Scroll or auto-focus to the **Review** section (Step 2).
- You'll see a card per exception (e.g., "LOW_CONFIDENCE_AUTO", "DUPLICATE").
- For each exception, you can:
  - **Dismiss** (checkbox + "Dismiss" button) — mark as reviewed, won't block close.
  - **Defer** (radio) — skip this period, revisit later.
  - Leave unchecked (default) — keeps the exception **open** = will block the lock.
- For this demo, **dismiss all exceptions** to let close proceed.
- Click the brass **"Journal"** CTA button.

**Expected functional result:**
- Backend `POST /entities/{entityId}/period/{breakId}/disposition` is called once per exception with `disposition: "dismissed"`.
- Each 200 response stores the disposition.
- No exceptions remain `open` = green light for lock.

**Expected visual landmark:**
- Each exception row shows a **severity icon** (`!` for high, `~` for medium).
- Dismissed rows fade to 60% opacity (grey text).
- The **Journal** button appears below (brass pill, `.btn-primary`).
- An **aria-live** region announces "X exceptions reviewed" (screen reader only, not visible but logged).

---

### Step 4: Journal & Trial Balance

**Action:**
- The **Journal** section expands (Step 3).
- You'll see a table of journal entries auto-generated from the ingest & classification.
- Scroll right to see: Debit (column), Credit (column), Account (column).
- Verify the TB (Trial Balance) row at the bottom shows **Debits = Credits** (both the same number, e.g., 50,000 USDC).
- Click the brass **"Snapshot"** CTA button.

**Expected functional result:**
- Backend `POST /entities/{entityId}/period/journal` confirms all JE legs.
- Backend recomputes TB: checks `sum(debits) == sum(credits)`.
- If balanced, 200 response. If not balanced (e.g., a rogue event), 400 with `{code: "TB_IMBALANCE"}`.
- For the fixture, it's balanced (3 events are valid).

**Expected visual landmark:**
- The Journal table's TB row shows a **green check ✓** in the rightmost cell (or class `.balance-verified`).
- The Debit & Credit amounts in the TB row are the same number (e.g., 50,000).
- The **Snapshot** button appears (brass pill, `.btn-primary`).

---

### Step 5: Snapshot & Merkle Root

**Action:**
- The **Snapshot** section expands (Step 4).
- You'll see a small card showing:
  - "Period: `2026-06-30` to `2026-07-30`"
  - "Event count: `3`"
  - "Merkle root: `0xabcd...1234`" (truncated hash, full shown on hover)
- Below that, two readiness cards (the **Cockpit lights**):
  - Card 1: **"Classification"** — green ✓ (was Classify step, now locked).
  - Card 2: **"Recon Breaks"** — red ✗ (placeholder example, fixture has no breaks).
- Click the brass **"Lock Period"** CTA button.

**Expected functional result:**
- Backend `POST /entities/{entityId}/period/lock` is called.
- This endpoint:
  - Checks **all blocking lights are green** (exceptions, recon, TB). If any red, returns 409 with `code: "LIGHTS_NOT_GREEN"`.
  - Checks for any unresolved exceptions = 409 `EXCEPTIONS_BLOCKING`.
  - Checks for material recon breaks = 409 `RECON_BREAKS_BLOCKING`.
  - If all green, creates a period-lock record in the `period_lock` table with status `LOCKED` and freezes the period.
- Returns 200 with the locked period metadata.

**Expected visual landmark:**
- The two Cockpit light cards refresh: **Classification** remains green ✓; **Recon** may stay red (mock, not blocking demo) or turn derived (⚠︎ grey).
- A banner appears: **"Period locked. Ready to anchor."** (green background, `.status-locked` or similar).
- The **Lock Period** button is replaced with a **"Prepare for Anchor"** button (still brass pill).

---

### Step 6: Prepare Anchor

**Action:**
- Click the brass **"Prepare for Anchor"** CTA button.

**Expected functional result:**
- Backend `POST /entities/{entityId}/period/snapshot` is called (again, but now with lock status verified).
- This computes the anchor-ready snapshot: merkle root, leaf hashes, manifest.
- Backend serializes the snapshot into a Sui transaction (not yet signed).
- Returns 200 with:
  - `snapshot`: { `id`, `merkleRoot`, `manifestHash`, `leafCount` }
  - `anchorTxPayload`: base64 serialized Sui transaction bytes.

**Expected visual landmark:**
- A **brass pill button** labeled **"Sign in Wallet"** appears (`.btn-primary`, never grayed).
- A small code block below shows:
  - "Merkle root: `0xabcd...1234`"
  - "Ledger leaf count: `47`"
  - "Ready to sign. Connect your wallet."

---

### Step 7: Connect Wallet & Sign

**Action:**
- In the top-right corner, you'll see the **ConnectButton** from dApp Kit (looks like a grey pill with a wallet icon or "Connect Wallet").
- Click it. A modal pops up showing testnet wallets (if you have Sui wallet extension installed) or a fake "demo" wallet option.
- **Select your cap-owner wallet** (the one that holds the AnchorCap `0x266e…`).
- Click **"Connect"**.
- Expected: the button now shows your wallet address (e.g., `0xbdec...ee01f`), no longer "Connect Wallet".
- Now click the brass **"Sign in Wallet"** CTA button (Step 6 panel).

**Expected functional result:**
- dApp Kit's `signTransaction` hook is invoked with the anchor-tx payload.
- Your wallet extension pops a signature dialog showing: `transaction`, `network: testnet`.
- You sign it (testnet key, no real money lost).
- Browser receives the signed transaction (`signature` + `txDigest` in the signing result).
- Browser calls `POST /entities/{entityId}/period/anchor/confirm` with:
  - `signature`: the wallet's signature bytes.
  - `signedTx`: the serialized signed transaction.
- Backend verifies the signature against the cap's public key (from Move contract state).
- Backend submits the signed TX to Sui blockchain via gRPC.
- Returns 200 with: `{digest: "3ne48Vigva…", link: "https://suiscan.xyz/testnet/txblock/3ne48Vigva…"}`.

**Expected visual landmark:**
- **Wallet extension**: browser shows "Sign Transaction" dialog (not under your control in this script, but you'll see it).
- **Web page**: a **"Signing…"** message appears under the button (brass text, slightly dimmed; class `.busy` or `:disabled`).
- After wallet confirms:
  - The button changes to **"Confirm"** (back to normal brass pill).
  - A **transaction hash** appears below:
    - "Digest: `3ne48Vigva…`" (hyperlinked to SuiScan explorer).
    - "Chain link: [View on SuiScan](https://suiscan.xyz/testnet/txblock/3ne48Vigva…)".

---

### Step 8: Confirm on Chain

**Action:**
- Click the brass **"Confirm"** button.

**Expected functional result:**
- Browser polls `GET /entities/{entityId}/period/anchor/{digest}` until it resolves to `confirmed: true` or times out.
- Backend queries the Sui chain: `getTransaction(digest)` to fetch the tx block.
- Parses the events to extract the on-chain `AnchorEvent` (emitted by the Move contract).
- Stores the anchor record in the `anchors` table with:
  - `snapshot_id`: matches the merkle root.
  - `digest`: the tx digest (immutable).
  - `sequenceNumber`: incremented from the previous anchor on the entity.
  - `previousMerkleRoot`: the last anchor's root (for hash-chain linkage).
- Returns 200 with the full anchor record.

**Expected visual landmark:**
- A **hash-chain row** appears below, showing the anchor history:
  - Row 1: "Seq 6 | Digest: `3ne48Vigva…` | Root: `0xabcd…` | ← linked to Seq 5"
  - The new row **turns green** (background color `.anchor-confirmed` or similar).
  - A **checkmark ✓** appears in the "Status" column for this anchor.
- A **celebration visual** plays (optional: confetti, SVG animation, or just a banner):
  - "✓ Period anchored successfully! All events frozen on-chain."
  - Color: gold or green (`.status-success` class).
- The **StepRail** shows all 5 boxes highlighted (1 2 3 4 5 — all brass or green, no more grey).

---

## Known Fail-Loud Errors

### Error 1: `409 ALREADY_ANCHORED`

**When you see it:**
- You click "Confirm" a second time on the same period.
- Or you re-run the demo without resetting the persistent DB.

**Root cause:**
- The persistent SQLite DB (`services/api/data/tallymarina.db`) stores anchor records across restarts.
- If the same `(entityId, periodId, snapshotId)` tuple is already anchored, the lock/snapshot endpoints reject it.
- This is **not a test harness bug** (that's the in-memory `SEQ_MISMATCH`).

**How to fix:**
```bash
# Stop both servers.
rm -f services/api/data/*.db
# Restart both servers (Tab 1 & 2).
```

Then re-run the demo from Step 1.

### Error 2: `CAP_NOT_OWNED_BY_WALLET`

**When you see it:**
- You connect a wallet that does **not** own the AnchorCap `0x266e…dfba9`.
- You click "Prepare for Anchor" or "Sign in Wallet".
- API returns: `{code: "CAP_NOT_OWNED_BY_WALLET", message: "This wallet does not own the required AnchorCap."}`.

**Root cause:**
- The `POST /entities/{entityId}/period/snapshot` endpoint checks (off-chain, before signing):
  - Is `SUI_PK`'s derived address the owner of the AnchorCap in the Move module state?
  - The Move contract emitted an event listing the cap owner's address.
  - If your connected wallet is different from the owner, 409 is returned.

**How to fix:**
```bash
# Option A: Transfer the cap to your wallet
sui client transfer --to <your-address> --object-id 0x266e7c8e...dfba9 --gas-budget 10000000

# Option B: Use a wallet that already owns the cap (if you have multiple wallets)
# — Disconnect the current wallet, re-click "Connect Wallet", select the cap-owner wallet.
```

Retry the demo from Step 6.

---

## Onboarding Sub-Walkthrough (Optional)

If you also want to test the **Onboarding Workspace**, here's the flow:

### Navigation

- Left sidebar: click **"Onboarding"** (navy underline + brass text, near the bottom of the soon-to-ready slots).

### Flow: Connect → Challenge → Sign → VERIFIED

**Step A: Connect Wallet**
- Top-right ConnectButton: click, select your wallet, connect.
- Expected: button shows your address.

**Step B: View Entity Onboarding**
- The Onboarding panel loads.
- You see a table of **Wallet Sources** (addresses that appeared in the entity's ingest events).
- One row shows a "Verify" button (brass pill, `.btn-primary`).

**Step C: Click Verify**
- Click the **"Verify"** button for any source row.
- Backend `POST /onboarding/{entityId}/challenge` generates a nonce and returns a challenge message.
- Expected: a modal pops up showing:
  - Challenge text: "Sign this message to verify wallet ownership: nonce=`abcd1234…`"
  - A brass **"Sign"** button.

**Step D: Sign the Challenge**
- Click the brass **"Sign"** button.
- Your wallet extension shows "Sign Personal Message" dialog.
- Sign it.
- Browser calls `POST /onboarding/{entityId}/verify` with the signature.
- Backend verifies the signature against your wallet address using `verifyPersonalMessageSignature` (Sui SDK).
- If valid, returns 200 with an attestation record.
- If invalid (wrong address, bad signature), returns 422 with:
  - `code: "BAD_SIGNATURE"` or `code: "ADDRESS_MISMATCH"` or `code: "CHALLENGE_INVALID"`.

**Expected visual landmark on success:**
- The verified row's status changes to **VERIFIED** badge.
- Badge class: `.ob-badge--verified` (green background, white text).
- Badge color (computed-style): `#2F7A5A` (credit green, not aqua).

### Connected Wallet ≠ Source Row (Error Case)

**Action:**
- Connect wallet A (e.g., `0xbdec…`).
- In the Onboarding table, find a row for wallet B (e.g., `0x1234…`).
- Click **"Verify"** on the wallet-B row.

**Expected result:**
- A red inline error appears **above the button**:
  - "**Connected wallet ≠ this source**"
  - Class: `.ob-bad` (red text, possibly light red background).
- The "Verify" button is disabled or greyed (but not removed).
- The "Sign" modal **does not** pop up.

**Why:**
- The client-side route guard mirrors the backend: you can only verify a source if your connected wallet matches that source's address.
- This saves a round-trip and gives immediate feedback.

---

## Summary Checklist

Before you run the demo, verify:

- [ ] Testnet wallet owns AnchorCap `0x266e7c8ea0b27ad52080074c9f6c1f73ec8a6ea9dd9a68d310b7cf56262dfba9`.
- [ ] `SUI_PK` is set in `services/api/.env`.
- [ ] `GEMINI_API_KEY` is set.
- [ ] `SUI_NETWORK=testnet` and `SUI_GRPC_URL=https://grpc.testnet.sui.io`.
- [ ] Deleted persistent DB: `rm -f services/api/data/*.db`.
- [ ] Testnet wallet has ≥0.1 SUI for gas.
- [ ] API server running: `cd services/api && npm start` (should say "Listening on port 8787").
- [ ] Web server running: `cd web && npm run dev` (should say "Local: http://localhost:5173").
- [ ] Browser open to `http://localhost:5173`.

Then follow the **Steps: Close-the-Period Flow** section above, verifying each visual landmark as you go. If you hit a fail-loud error, check the **Known Fail-Loud Errors** section.

**Enjoy the demo!**
