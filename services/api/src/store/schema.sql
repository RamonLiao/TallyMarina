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
  period_id TEXT
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
  status TEXT NOT NULL
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
  was_anchored_at_reopen  INTEGER,
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
