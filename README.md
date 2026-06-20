# ⚓ TallyMarina

**AI-Assisted Digital Asset Subledger & Accounting Orchestration on Sui**

---

### ⚠️ The Pain Points in Crypto Accounting

Enterprise adoption of stablecoins, custody providers, and DeFi protocols (like DeepBook) is surging. However, finance teams face critical challenges:
1. **🗄️ Data Fragmentation**: Wallets, centralised exchanges (CEXs), custodian platforms, bank accounts, and ERP systems reside in isolated silos with mismatched data formats and timelines.
2. **🔍 Technical vs. Financial Event Gap**: On-chain data verifies *what* technical operation occurred, but fails to capture the *why* (the commercial purpose and semantic context).
3. **⏳ Manual, Error-Prone Close Processes**: Finance teams spend days using spreadsheets to manually categorise, price, and reconcile crypto transactions.
4. **⚖️ Divergent Accounting Policies**: Companies must apply complex accounting frameworks (e.g., IFRS vs. US GAAP) that have differing treatments for stablecoins, staking, or gas fees.
5. **🕵️‍♂️ Scattered Audit Trails**: Auditing crypto transactions is painful due to a lack of clear lineage linking journal entries in ERPs back to price feeds, historical policies, and exact on-chain actions.
6. **⛓️ Sui-Specific Schema Barriers**: Traditional subledgers are built for accounts-based chains and struggle to parse Sui's object-centric model and protocol-specific events.

---

### 💡 The Solution: TallyMarina

**TallyMarina** bridges the gap between on-chain operations and enterprise financial reporting (NetSuite, SAP, etc.) as a dedicated accounting orchestration layer.

*   **🔄 Sui-Native Normalisation**: Parses complex Sui transaction blocks and object states into clean, unified financial events (e.g., `DIGITAL_ASSET_RECEIPT`, `SPOT_TRADE_SWAP`).
*   **🤖 AI-Assisted Classification with Safe Guardrails**: Utilises an AI assistant to suggest economic purposes, categorisations, and counterparty metadata. High-confidence transactions are processed via deterministic rules, while exceptions are routed to human reviewers. AI has *no* posting authority.
*   **🎯 Policy-Driven Accounting Engine**: Supports customisable rulesets aligned with IFRS and US GAAP (e.g., IAS 38 cost models, FIFO lot evaluation), mapping events directly to your Chart of Accounts.
*   **📖 Double-Entry Journal Engine**: Translates normalised events into balanced debit/credit journal entries with functional and reporting currency conversions.
*   **🛡️ Tamper-Evident On-Chain Auditing**: Bundles period closures into immutable audit packs. The manifest hash and journal entry Merkle roots are anchored onto the Sui blockchain via the `AuditAnchor` Move package, creating an append-only, verifiable hash chain.
*   **📤 ERP-Ready Output**: Exports verified batches to main ledger ERPs while preventing double-posting through rigorous status lifecycle tracking.

---

### 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Enterprise Finance Layer                   │
│   CFO / Accountant / Auditor  │  ERP (SAP, NetSuite)  │  UI  │
└───────────────────────────────▲─────────────────────────────┘
                                │ Journal Entries / Audit Evidence
┌───────────────────────────────┴─────────────────────────────┐
│                        TallyMarina                          │
│   Review Queue │ AI Suggestions │ Rules Engine │ ERP I/O    │
│   Reconciliation │ Pricing & Lots │ Snapshot Svc │ RBAC     │
└───────────────────────────────▲─────────────────────────────┘
                                │ Normalised Financial Events
┌───────────────────────────────┴─────────────────────────────┐
│                    Data & Trust Anchor Layer                │
│    Sui SDK / RPC / Indexer  │  CEXs / Custody / CSVs        │
│    DeepBook Parsers  │  Walrus Snapshot  │  Move Smart Contract│
└─────────────────────────────────────────────────────────────┘
```

---

### 📂 Project Structure

*   [`/move/audit_anchor`](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/0-Agentic-Web/Sui-Agentic-Subledger/move/audit_anchor): The Sui Move package hosting the append-only cryptographic audit chain.
*   [`/services/ingestion`](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/0-Agentic-Web/Sui-Agentic-Subledger/services/ingestion): Node.js/TypeScript background ingestion service for querying and standardising transaction streams.
*   [`/specs`](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/0-Agentic-Web/Sui-Agentic-Subledger/specs): Comprehensive business specification (`business-spec-v3.md`) and accounting rules (`accounting-spec-v3.md`).
*   [`/docs/architecture`](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/0-Agentic-Web/Sui-Agentic-Subledger/docs/architecture): Detailed architectural specification and design-partner scope bounds.
