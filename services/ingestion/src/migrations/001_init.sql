CREATE TABLE IF NOT EXISTS raw_transaction (
  digest        TEXT PRIMARY KEY,
  entity_ref    TEXT NOT NULL,
  checkpoint    BIGINT NOT NULL,
  timestamp_ms  BIGINT NOT NULL,
  status        TEXT NOT NULL,
  raw_json      JSONB NOT NULL,
  content_hash  TEXT NOT NULL,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS raw_effect (
  digest        TEXT NOT NULL REFERENCES raw_transaction(digest),
  raw_index     INT NOT NULL,
  kind          TEXT NOT NULL,
  coin_type     TEXT, amount TEXT, decimals INT,
  counterparty  TEXT, object_id TEXT, raw_ref TEXT,
  PRIMARY KEY (digest, raw_index)
);
CREATE TABLE IF NOT EXISTS ingestion_checkpoint (
  entity_ref TEXT NOT NULL, address TEXT NOT NULL, source_kind TEXT NOT NULL,
  last_cursor TEXT, last_checkpoint BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_ref, address, source_kind)
);
CREATE TABLE IF NOT EXISTS ingestion_anomaly (
  id BIGSERIAL PRIMARY KEY, digest TEXT, entity_ref TEXT,
  kind TEXT NOT NULL, detail JSONB, detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
