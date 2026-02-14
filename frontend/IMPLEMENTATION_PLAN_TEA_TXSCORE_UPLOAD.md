# TEA & TxScore Upload & Results Implementation Plan

## Overview
Implement comprehensive upload, analysis tracking, and results viewing for both Therapeutic Editability Atlas (TEA) and Therapeutic Translation Platform (TxScore).

## Components to Create

### 1. Database Schema (Supabase Migration)
```sql
-- TEA Analyses Table
CREATE TABLE tea_analyses (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  sequence TEXT NOT NULL,
  sequence_source TEXT, -- 'manual', 'file', 'clinvar', 'dbsnp'
  status TEXT NOT NULL, -- 'created', 'running', 'complete', 'failed'
  progress INTEGER DEFAULT 0,
  current_step TEXT,
  parameters JSONB,
  results JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TxScore Analyses Table  
CREATE TABLE txscore_analyses (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  gene_list TEXT[] NOT NULL,
  gene_source TEXT, -- 'manual', 'file', 'screen_import'
  source_analysis_id TEXT, -- If imported from CRISPR screen
  status TEXT NOT NULL,
  progress INTEGER DEFAULT 0,
  current_step TEXT,
  parameters JSONB,
  results JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Sequence/Gene Upload Components
- **TEA Sequence Uploader**: Support FASTA, plain text, GenBank, VCF, manual input
- **TxScore Gene List Uploader**: Support CSV, TSV, TXT, manual input, screen import

### 3. API Routes
- `/api/tea/analyses` - Create/list TEA analyses
- `/api/tea/analyses/[id]` - Get/update TEA analysis
- `/api/txscore/analyses` - Create/list TxScore analyses  
- `/api/txscore/analyses/[id]` - Get/update TxScore analysis

### 4. Results Pages
- `/tea/results/[id]` - TEA analysis results dashboard
- `/txscore/results/[id]` - TxScore analysis results dashboard

### 5. Dashboard Integration
- Show TEA and TxScore analyses in main dashboard
- Filter by analysis type
- Status badges for each analysis type

## Implementation Steps

1. ✅ Create database migration
2. ✅ Create upload components with parsers
3. ✅ Create API routes
4. ✅ Create results dashboard pages
5. ✅ Update main dashboard
6. ✅ Add hooks for data fetching
7. ✅ Test end-to-end flow

## File Parsers Needed

### TEA Sequence Parsers
- FASTA (single/multiple sequences)
- GenBank
- Plain text (A/T/G/C)
- VCF (extract sequence context)
- Manual textarea input

### TxScore Gene List Parsers
- CSV (various column formats)
- TSV
- Plain text (one gene per line)
- Excel (.xlsx)
- Gene symbols validation via HGNC

## Next Steps
Run this implementation systematically to ensure all components work together.
