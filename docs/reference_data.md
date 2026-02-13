# Reference Data Documentation

## sgRNA Libraries

### Brunello (Human)
The pipeline integrates the Broad GPP Brunello library for human CRISPR knockout screens.

- **Source**: [Addgene - Broad GPP Brunello Library](https://www.addgene.org/pooled-library/broadgpp-brunello-library/)
- **Target File**: `broadgpp-brunello-library-contents.txt`
- **Total sgRNAs**: ~76,441 (targeting ~19,114 genes)

#### Integration Details
- **Raw Data**: Stored in `data/raw/brunello/broadgpp-brunello-library-contents.txt`.
- **Processed Data**: Converted to Parquet format at `data/processed/brunello/brunello_library.parquet`.
- **Loaders**:
  - **Backend (Python)**: `src/crispr_confidence/ref_data.py` -> `load_brunello_library()`
  - **Frontend (TypeScript)**: `frontend/src/lib/analysis/analysis-utils.ts` -> `loadRealLibrary('brunello')`

#### Usage
To download the library manually:
```bash
python scripts/download_brunello.py
```

To parsing and process the library (if raw file exists):
```bash
python src/crispr_confidence/data_processing/brunello_library.py
```

To upload to cloud storage (requires credentials):
```bash
python scripts/upload_brunello.py
```
