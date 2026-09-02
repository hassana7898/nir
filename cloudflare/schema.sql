CREATE TABLE IF NOT EXISTS app_storage (
  collection_name TEXT NOT NULL,
  document_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (collection_name, document_id)
);
CREATE INDEX IF NOT EXISTS app_storage_updated_at_idx ON app_storage(updated_at);
