-- Online Documents module (Word-style rich text docs & lightweight spreadsheets)
-- Metadata stored in D1; structured JSON body stored in R2 (d/{userId}/{docId}.json)

CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES category(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL,                 -- 'doc' | 'sheet'
  title TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  sync_seq INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS document_user_list_idx
  ON document(user_id, deleted_at, doc_type, is_pinned DESC, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS document_user_category_idx
  ON document(user_id, category_id, deleted_at);
CREATE INDEX IF NOT EXISTS document_user_sync_idx
  ON document(user_id, sync_seq);
