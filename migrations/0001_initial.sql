-- Notepad D1 initial schema (Milestone 1 + Phase 2/4 sync & 2FA base tables)

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  email TEXT UNIQUE,
  name TEXT,
  avatar_url TEXT,
  password_hash TEXT,
  password_salt TEXT,
  disabled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS user_disabled_at_idx ON user(disabled_at);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_login TEXT,
  provider_email TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(provider, provider_user_id),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(user_id);

CREATE TABLE IF NOT EXISTS system_bootstrap (
  singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
  admin_user_id TEXT NOT NULL REFERENCES user(id),
  initialized_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS role (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_role (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, role_id)
);

CREATE INDEX IF NOT EXISTS user_role_user_id_idx ON user_role(user_id);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS session_token_hash_idx ON session(token_hash);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session(user_id);
CREATE INDEX IF NOT EXISTS session_expires_at_idx ON session(expires_at);

CREATE TABLE IF NOT EXISTS device_session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  token_family_id TEXT NOT NULL,
  revoked_at INTEGER,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS device_session_user_idx ON device_session(user_id);

CREATE TABLE IF NOT EXISTS user_sync_state (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  current_seq INTEGER NOT NULL DEFAULT 0,
  min_retained_seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS category (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES category(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  sync_seq INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS category_user_active_idx ON category(user_id, deleted_at, sort_order, created_at);
CREATE INDEX IF NOT EXISTS category_user_sync_idx ON category(user_id, sync_seq);

CREATE TABLE IF NOT EXISTS note (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES category(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  sync_seq INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS note_user_list_idx ON note(user_id, deleted_at, is_pinned DESC, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS note_user_category_idx ON note(user_id, category_id, deleted_at);
CREATE INDEX IF NOT EXISTS note_user_sync_idx ON note(user_id, sync_seq);

CREATE TABLE IF NOT EXISTS file_object (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES category(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  sync_seq INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS file_user_active_idx ON file_object(user_id, deleted_at, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS file_user_category_idx ON file_object(user_id, category_id, deleted_at);
CREATE INDEX IF NOT EXISTS file_user_sync_idx ON file_object(user_id, sync_seq);

CREATE TABLE IF NOT EXISTS note_file (
  note_id TEXT NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES file_object(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(note_id, file_id)
);

CREATE TABLE IF NOT EXISTS file_upload_session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES category(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  declared_size INTEGER NOT NULL,
  part_size INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  r2_upload_id TEXT NOT NULL,
  parts_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'uploading',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS upload_session_user_status_idx ON file_upload_session(user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS share_link (
  id TEXT PRIMARY KEY,
  share_code TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'download',
  access_password_hash TEXT,
  access_password_salt TEXT,
  max_views INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS share_user_idx ON share_link(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_expires_idx ON share_link(expires_at);
CREATE INDEX IF NOT EXISTS share_target_idx ON share_link(target_type, target_id);

CREATE TABLE IF NOT EXISTS totp_entry (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES category(id) ON DELETE SET NULL,
  issuer TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  encryption_mode TEXT NOT NULL DEFAULT 'server_kms',
  key_version INTEGER NOT NULL DEFAULT 1,
  algorithm TEXT NOT NULL DEFAULT 'SHA1',
  digits INTEGER NOT NULL DEFAULT 6,
  period INTEGER NOT NULL DEFAULT 30,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  sync_seq INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS totp_user_sync_idx ON totp_entry(user_id, sync_seq);

CREATE TABLE IF NOT EXISTS pending_r2_deletion (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  r2_upload_id TEXT,
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO role (id, name, description, created_at, updated_at)
VALUES
  ('role_admin',   'admin',   'Site administrator (unrestricted within Cloudflare limits)', unixepoch() * 1000, unixepoch() * 1000),
  ('role_member',  'member',  'Member user: 50MB files, 500 max, anonymous sharing', unixepoch() * 1000, unixepoch() * 1000),
  ('role_user',    'user',    'Standard user: notes, 5MB files, 100 max', unixepoch() * 1000, unixepoch() * 1000),
  ('role_pending', 'pending', 'Default user with no permissions until authorized', unixepoch() * 1000, unixepoch() * 1000);
