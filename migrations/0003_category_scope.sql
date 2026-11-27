-- Scope custom categories independently per module: 'note' | 'document' | 'file'
-- NULL category_id represents the system built-in "默认" (Default) category.

ALTER TABLE category ADD COLUMN scope TEXT NOT NULL DEFAULT 'note';

CREATE INDEX IF NOT EXISTS category_user_scope_idx
  ON category(user_id, scope, deleted_at, sort_order, created_at);
