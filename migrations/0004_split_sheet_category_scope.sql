-- Split online spreadsheets (Excel) into their own independent category scope ('sheet'),
-- separate from Word documents ('document').

UPDATE category
SET scope = 'sheet'
WHERE scope = 'document'
  AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM document d
    WHERE d.category_id = category.id AND d.doc_type = 'sheet'
  )
  AND NOT EXISTS (
    SELECT 1 FROM document d
    WHERE d.category_id = category.id AND d.doc_type = 'doc'
  );

UPDATE document
SET category_id = NULL
WHERE doc_type = 'sheet'
  AND category_id IS NOT NULL
  AND category_id IN (SELECT id FROM category WHERE scope != 'sheet');
