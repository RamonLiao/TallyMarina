CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  chain_object_id TEXT NOT NULL,
  cap_object_id TEXT NOT NULL,
  original_package_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  raw_json TEXT NOT NULL,
  ai_event_type TEXT, ai_purpose TEXT, ai_counterparty TEXT,
  ai_confidence REAL, ai_reasoning TEXT,
  final_event_type TEXT, final_purpose TEXT,
  status TEXT NOT NULL,
  period_id TEXT
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  je_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  leaf_hash TEXT NOT NULL,
  period_id TEXT,
  policy_set_version TEXT,
  rule_version TEXT
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  period_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  leaf_count INTEGER NOT NULL,
  supersedes_seq INTEGER,
  status TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1,
  restatement_reason_code TEXT,
  restatement_reason TEXT,
  affected_amount_estimate TEXT,
  restatement_requested_by TEXT,
  restatement_approved_by TEXT,
  UNIQUE (entity_id, period_id, seq)
);
CREATE TABLE IF NOT EXISTS anchors (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
  seq INTEGER NOT NULL,
  link TEXT NOT NULL,
  digest TEXT NOT NULL,
  explorer_url TEXT NOT NULL,
  anchored_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exception_disposition (
  category    TEXT NOT NULL,
  event_id    TEXT NOT NULL REFERENCES events(id),
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  state       TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_note TEXT,
  decided_by  TEXT NOT NULL,
  decided_at  INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'HUMAN',
  proposal_id INTEGER,
  period_id TEXT,
  PRIMARY KEY (category, event_id)
);
CREATE TABLE IF NOT EXISTS exception_disposition_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  state       TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_note TEXT,
  decided_by  TEXT NOT NULL,
  decided_at  INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'HUMAN',
  proposal_id INTEGER,
  period_id TEXT
);
CREATE TABLE IF NOT EXISTS recon_break_disposition (
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  period_id   TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  coin_type   TEXT NOT NULL,
  state       TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_note TEXT,
  decided_by  TEXT NOT NULL,
  decided_at  INTEGER NOT NULL,
  PRIMARY KEY (entity_id, period_id, wallet, coin_type)
);
CREATE TABLE IF NOT EXISTS recon_break_disposition_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   TEXT NOT NULL,
  period_id   TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  coin_type   TEXT NOT NULL,
  prev_state  TEXT,
  state       TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_note TEXT,
  decided_by  TEXT NOT NULL,
  decided_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS period_lock (
  entity_id               TEXT NOT NULL REFERENCES entities(id),
  period_id               TEXT NOT NULL,
  status                  TEXT NOT NULL,
  locked_at               INTEGER,
  locked_by               TEXT,
  lights_snapshot         TEXT,
  reopened_at             INTEGER,
  reopen_count            INTEGER NOT NULL DEFAULT 0,
  restatement_reason      TEXT,
  reason_code             TEXT,
  affected_amount_estimate TEXT,
  requested_by            TEXT,
  approved_by             TEXT,
  PRIMARY KEY (entity_id, period_id)
);
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
CREATE TABLE IF NOT EXISTS triage_proposal (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  exception_id  TEXT NOT NULL,
  event_id      TEXT NOT NULL REFERENCES events(id),
  entity_id     TEXT NOT NULL REFERENCES entities(id),
  period_id     TEXT NOT NULL,
  action        TEXT NOT NULL,
  reason_code   TEXT NOT NULL,
  reason_note   TEXT,
  rationale     TEXT NOT NULL,
  confidence    REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'proposed',
  model         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  decided_by    TEXT,
  decided_at    INTEGER,
  decision_note TEXT,
  recall_context TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_triage_open ON triage_proposal(exception_id) WHERE status = 'proposed';
CREATE TABLE IF NOT EXISTS triage_proposal_log (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id   INTEGER NOT NULL,
  exception_id  TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  status        TEXT NOT NULL,
  decided_by    TEXT,
  decision_note TEXT,
  at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_entity_period ON events (entity_id, period_id);
CREATE INDEX IF NOT EXISTS idx_je_entity_period ON journal_entries (entity_id, period_id);
CREATE INDEX IF NOT EXISTS idx_expdisp_entity_period ON exception_disposition (entity_id, period_id);
CREATE TABLE IF NOT EXISTS rejected_event_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   TEXT NOT NULL,
  period_id   TEXT NOT NULL,
  event_time  TEXT NOT NULL,
  raw_json    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  rejected_at TEXT NOT NULL
);
-- C4 (spec §2): append-only lot movement ledger. Signed deltas mirror the engine's
-- LotMovement (+acquire/−dispose = quantity direction, NOT debit/credit).
-- Derived ledger: rows are a materialized audit trail; truth is recomputable from events.
CREATE TABLE IF NOT EXISTS lot_movement (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  je_id TEXT REFERENCES journal_entries(id),      -- NULL for zero-basis OPENING_LOT (no JE) and pre-feature legacy rows; non-zero OPENING_LOT does get a JE
  lot_id TEXT NOT NULL,
  lot_seq TEXT NOT NULL,                          -- sortable FIFO key: '<eventTime>|<eventId>' (lot_id is NOT chronological)
  period_id TEXT NOT NULL,
  coin_type TEXT NOT NULL,
  wallet TEXT NOT NULL,
  delta_qty_minor TEXT NOT NULL,                  -- signed BigInt string
  delta_cost_minor TEXT NOT NULL,
  cost_basis_method TEXT NOT NULL,                -- 'FIFO' constant this round; append-only provenance
  policy_set_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_lot_movement_pool ON lot_movement (entity_id, wallet, coin_type);
CREATE TABLE IF NOT EXISTS migration_override_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id TEXT NOT NULL,
  old_root TEXT NOT NULL,
  recomputed_root TEXT NOT NULL,
  operator TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  justification TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_registry (
  entity_id            TEXT NOT NULL REFERENCES entities(id),
  coin_type            TEXT NOT NULL,
  decimals             INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  symbol               TEXT NOT NULL,
  display_name         TEXT NOT NULL,
  source               TEXT NOT NULL CHECK (source IN ('chain','manual')),
  chain_object_id      TEXT,
  metadata_cap_state   TEXT CHECK (metadata_cap_state IS NULL OR metadata_cap_state IN ('UNKNOWN','CLAIMED','UNCLAIMED','DELETED')),
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

-- Spec 2026-07-11 policyset-coa-persistence §3: append-only versioned policy documents.
-- active = MAX(version). Rows are NEVER updated or deleted (restatement interface: versions coexist).
CREATE TABLE IF NOT EXISTS policy_sets (
  entity_id  TEXT NOT NULL REFERENCES entities(id),
  version    INTEGER NOT NULL,
  doc        TEXT NOT NULL,      -- JSON: PolicyDoc (§9.1 ten fields + 6 version dims + roundingThresholdMinor)
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (entity_id, version)
);
CREATE TABLE IF NOT EXISTS coa_mapping_sets (
  entity_id    TEXT NOT NULL REFERENCES entities(id),
  version      INTEGER NOT NULL,
  rules        TEXT NOT NULL,    -- JSON: [{eventType, leg, account}], leg='*' catch-all
  rule_version TEXT NOT NULL,    -- audit anchor: equals doc.ruleVersion written in the same transaction
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  PRIMARY KEY (entity_id, version)
);
CREATE TABLE IF NOT EXISTS accounts (
  entity_id      TEXT NOT NULL REFERENCES entities(id),
  name           TEXT NOT NULL,  -- the JE-line account string (single authority, no id alias)
  class          TEXT NOT NULL CHECK (class IN ('asset','liability','equity','income','expense')),
  source_section TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('active','reserved_p1')),
  PRIMARY KEY (entity_id, name)
);
-- Task 4 (period-end revaluation, MVP manual price path): append-only manual price entry.
-- No UPDATE/DELETE path exists anywhere in code — a re-entered price for the same
-- (coin_type, as_of) is a NEW row; "current" is resolved at read time (latest by
-- created_at, rowid tiebreak), never by mutating a prior row (D19-style history).
CREATE TABLE IF NOT EXISTS price_points (
  id                TEXT PRIMARY KEY,
  entity_id         TEXT NOT NULL REFERENCES entities(id),
  coin_type         TEXT NOT NULL,
  as_of             TEXT NOT NULL,
  price_minor       TEXT NOT NULL,   -- fiat minor units (price * 100), BigInt string — never float
  quote_currency    TEXT NOT NULL,
  principal_market  TEXT NOT NULL,
  source            TEXT NOT NULL,
  level             TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_points_lookup ON price_points (entity_id, coin_type, as_of, created_at);
CREATE TABLE IF NOT EXISTS change_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  actor       TEXT NOT NULL,
  at          TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('policy_set','mapping_rule','asset_class','manual_price','je_void')),
  object_ref  TEXT NOT NULL,
  before      TEXT,              -- JSON; NULL for the first human change of an object
  after       TEXT NOT NULL,
  reason      TEXT NOT NULL
);
