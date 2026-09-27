-- ============================================================================
-- 0010 · Loosen the Ensembl gene index
--
-- HGNC is not one-to-one with Ensembl: a small number of approved symbols
-- share an ensembl_gene_id (for example ENSG00000230417 maps to both
-- LINC00595 and LINC00597). The unique index rejected the real file, so the
-- natural key stays (taxid, symbol) and ensembl_id is merely indexed.
-- ============================================================================

drop index if exists atlas.genes_ensembl_uq;
create index if not exists genes_ensembl_ix on atlas.genes (ensembl_id) where ensembl_id is not null;
