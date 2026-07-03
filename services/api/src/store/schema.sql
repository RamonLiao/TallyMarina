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
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  je_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  leaf_hash TEXT NOT NULL
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
  proposal_id INTEGER
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
  decision_note TEXT
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
