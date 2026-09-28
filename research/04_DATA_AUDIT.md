# Data provenance, licensing and contamination audit

Audit date: 2026-09-27. This inventory combines read-only local inspection with official sources. “Present” means a local file/directory exists, not that every record was independently revalidated. No production database was changed, no reference data was deleted, and no restricted files were redistributed by this audit.

## 1. Benchmark snapshot and metadata measurements

Local source: `data/references/assaybench/snapshot/biogrid/train-00000-of-00001.parquet`.

- Hugging Face cached revision: `bc37bf8f4842b43abcd6e9f781423d478b9aee4b`.
- Parquet SHA-256 measured in this audit: `25e00c380358486137d1f25c490db98d007dfc5230f8ad502276dc6ccc741a5c`.
- Metadata-only scan reproduces 1,349 training, 218 validation and 334 test entries.
- Training contains **134 distinct `source_id` values**, far fewer independent publications than screen entries.
- Separate LaTest resource is present. Its public status means it is not a new secret prospective set.
- The dataset card declares MIT; the code license does not automatically cover separately obtained external features. [Official dataset card](https://huggingface.co/datasets/Genentech/assaybench).

This audit read split and descriptive columns, not target label arrays, to produce the following training-only summary. Missing sentinels were null, empty string, `-`, `na`, `n/a`, `none`, `nan`, `not specified`, `not provided`, and `unknown`, case-insensitively after trimming. These are syntactic completeness counts, not an assertion of biological accuracy.

| Training metadata field | Missing / 1,349 | Interpretation |
|---|---:|---|
| Cell line | 1 | A nonempty string can still describe an ambiguous/engineered derivative |
| Cell type | 0 | Ontology mapping still requires review |
| Phenotype / cleaned phenotype | 0 / 0 | Curated labels are not necessarily prospective descriptions |
| Library methodology | 0 | Modality strings require explicit vocabulary mapping |
| Condition name | 987 | May mean no chemical condition or incomplete metadata; do not impute a drug |
| Condition dosage | 1,044 | A dose-dependent model needs explicit missingness and an appropriate subset |
| Duration | 0 | Nonempty durations still need units, ranges and parsing checks |

| Training category | Entries |
|---|---:|
| Fitness / Proliferation / Viability | 947 |
| Drug / Chemical / Environmental Response | 278 |
| Molecular Output / Reporter / Pathway Activity | 48 |
| Trafficking / Localization / Structural Phenotypes | 38 |
| Host-Pathogen / Infection Response | 38 |

These exact snapshot counts differ slightly from counts printed in the paper's category table. Use the pinned artifact as the computational denominator and retain the discrepancy rather than changing rows to fit a printed table. Publication identifiers are a minimum grouping key; shared experiments can also cross different source identifiers.

Reproduction of the metadata scan:

```python
import collections
import hashlib
from pathlib import Path
import pyarrow.parquet as pq

path = Path("data/references/assaybench/snapshot/biogrid/train-00000-of-00001.parquet")
columns = ["yearfold0", "source_id", "cell_line", "cell_type", "phenotype",
           "cleaned_phenotype", "library_methodology", "condition_name",
           "condition_dosage", "duration"]
rows = pq.read_table(path, columns=columns).to_pylist()
train = [row for row in rows if row["yearfold0"] == "train"]
missing = {"", "-", "na", "n/a", "none", "nan", "not specified", "not provided", "unknown"}
with path.open("rb") as handle:
    print(hashlib.file_digest(handle, "sha256").hexdigest())
print(collections.Counter(row["yearfold0"] for row in rows))
print(len({row["source_id"] for row in train}))
print({key: sum(row[key] is None or str(row[key]).strip().lower() in missing
                for row in train) for key in columns[2:]})
```

## 2. Local storage inventory

Measured using `du -sh data/references/*`; sizes include extracted files and caches, are rounded filesystem usage, and can change during other work. They are not the expected download sizes of a clean installation.

| Local directory | Observed disk use | Role |
|---|---:|---|
| `annotation` | 266 MB | HGNC/NCBI/Ensembl maps |
| `assaybench` | 260 MB | Pinned benchmark and outputs |
| `cells` | 117 MB | Cellosaurus and cell model metadata |
| `coordinates` | 102 MB | Genome/guide coordinates |
| `depmap` | 3.1 GB | Dependency, CN and model files, multiple releases |
| `derived` | 308 MB | Rebuildable feature caches |
| `dgidb` | 12 MB | Drug–gene claims |
| `genesets` | 48 KB | Essential/nonessential references |
| `libraries` | 163 MB | Guide library definitions |
| `literature` | 3.1 GB | PubTator-related files |
| `morphic` | 6.2 GB | Perturbational resources |
| `offtarget` | 227 MB | Guide specificity evidence |
| `opentargets` | 1.3 GB | Target/disease/drug/evidence Parquet |
| `orcs` | 1.5 GB | Original archives, metadata and parsed data |
| `projectscore` | 3.5 GB | Restricted Sanger dependencies |
| `reactome` | 1.3 MB | Pathway mapping |
| `string` | 90 MB | Human interaction files |

Existing resources exceed 20 GB and are sufficient for initial controlled experiments. Prefer projected Parquet columns, sparse measured/hit matrices and deterministic caches over new multi-gigabyte downloads. `engine/splicr/lake.py` and `scripts/data/build-lake.py` already implement a file-based reference lake. Postgres should hold identity, access control, provenance and job metadata, not duplicate every guide and matrix cell.

## 3. Source-by-source scientific and rights assessment

The rows below are operational source assessments, not a legal opinion. Where exact file rights are not established, the status remains unresolved. Retain source notices, exact version and retrieval date alongside artifacts.

### BioGRID ORCS

**Content/use:** Published screen metadata and gene-level scores/hit calls; historical priors and transfer (Track A) and cross-screen comparison (Track B). Local release `2.0.18`, dated September 2025 in `orcs/SOURCES.txt`, includes 1,952 human screens and other species. The local manifest records archive hashes and 26,333,098 human gene rows; those existing counts were not recomputed here.

**Quality/identity:** Author thresholds and up to five score columns are heterogeneous; scores need `SCORE.n_TYPE`, significance criteria and direction. A `-` is a missing sentinel. Gene aliases may be ambiguous. `source_id` may be PMID, DOI or URL. Local provenance records an erroneous 1970 author year for a 2021 paper; do not infer chronology from an unchecked author string. [Official curation guidance](https://wiki.thebiogrid.org/doku.php/orcs%3Acuration_guide).

**Rights/cost/risk:** BioGRID's linked terms provide MIT-style permissions and notice retention. Preserve the exact source terms and original-paper attribution. Archive is already local, approximately 1.5 GB with derived files. ORCS contains benchmark labels; whitelist by experiment and publication, not merely gene. [BioGRID terms](https://wiki.thebiogrid.org/doku.php/terms_and_conditions).

### DepMap and CCLE

**Content/use:** Gene effects/dependency probabilities, model identities, expression, mutation and CN. Useful cell context and artifact evidence; fitness measurements overlap with CRISPR targets. CCLE is a collection of molecular characterizations, not a universal dependency ground truth.

**Versions:** Local 24Q4 files and a partial 26Q1 Chronos output coexist. The 26Q1 manifest cites DOI `10.6084/m9.figshare.31660582.v2`, deposited 2026-08-03, and lists 1,208 models × 18,531 genes. It is not the complete release; older model/CN files have different row/column coverage. Stable `ACH-` IDs and Entrez/Ensembl crosswalks are mandatory. These releases are later than the primary training cutoff.

**Rights:** Existing files report CC BY 4.0 in local release metadata, and the official DepMap support answer says generated DepMap data generally use that license while hosted third-party data can differ. The current portal terms endpoint returned a verification page during this audit. Therefore retain and verify the license of each exact release/file; do not extend one file's permission to every hosted dataset or future release. [Official DepMap guidance](https://forum.depmap.org/t/license-for-data-found-in-the-depmap-portal/130), [current terms endpoint](https://depmap.org/portal/terms/).

**Contamination/cost:** Pan-cancer summaries are not automatically clean: they can aggregate target-derived measurements or future information. Removing only the query model is insufficient if related experiments remain. Use dated eligible panels and record component samples; strict training-only models should exclude these modern releases. Local 3.1 GB; float32 matrices and compressed columnar metadata can avoid repeated CSV parsing.

### Cell Model Passports and Sanger Project Score

**Content/use:** Cell identity, derivation relationships, genomic features and CRISPR dependency data. Useful for matching and context, but parental lines and engineered derivatives are not exchangeable. Local `projectscore/LICENSE.md` and `MANIFEST.md` explicitly mark restricted data.

**Rights:** The Sanger data policy permits internal proprietary research and education but excludes ordinary commercial services/resale under that license; commercial API/data use and direct use by third-party sites require prior consent. No such permission is established by this audit. Keep direct Sanger files out of public customer exports and model-service feature paths until rights are resolved. [Official policy](https://depmap.sanger.ac.uk/documentation/data-usage-policy/).

**Temporal/quality/cost:** Use versioned model relationships, exact experiment source and model authentication. Sanger dependencies overlap ORCS and other portal releases. Local Project Score is 3.5 GB; choose projections instead of importing full matrices into the application database. Do not infer rights to direct Sanger files from Open Targets' separate agreements.

### STRING

**Content/use:** Functional/physical association networks and evidence channels; candidate representation and pathway support for both tracks. Local human v12.0 files have source hashes. STRING's version history dates v12.0 to 2023-07-26; a 12.5 preview became available in August 2026. Version 11.0b predates the end-2020 boundary and is a possible historical experiment input, subject to component evidence review. [Official access/version/license page](https://string-db.org/cgi/access).

**Rights/quality/risk/cost:** CC BY 4.0 with attribution. Stable protein-to-gene mapping can be one-to-many. Degree and annotation richness introduce bias; text-mining and experimental channels may contain target evidence. Local 90 MB, sparse human subgraphs inexpensive. A biological graph lacking a literal hit column is not necessarily free from label contamination.

### Reactome and Gene Ontology

**Content/use:** Curated pathways, process/function/location terms and gene annotations. Useful gene representations, explanation, enrichment and batch diversity. Incomplete coverage is not a negative biological result. Pathway hierarchies and term versions affect overlap and diversity measures.

**Versions/rights:** Local Reactome retrieval is 2026-09-27 with recorded modification date 2026-06-21; a `current` URL alone is not a release pin. Reactome annotation/mapping files are CC0, while some dumps, software and illustrations carry CC BY 4.0. GO data are CC BY 4.0; cite release DOI/date. [Reactome licensing](https://reactome.org/about/news/97-updated-license-agreement), [Reactome releases](https://reactome.org/download-data), [GO license/citation](https://geneontology.org/docs/go-citation-policy/).

**Compatibility/risk/cost:** Retain source identifiers, obsolete-term mapping, GO evidence codes and references. Future annotations can encode target publications. Use historical releases/claims in cutoff-controlled studies. The local pathway file is 1.3 MB; compressed membership matrices are small compared with expression data.

### Open Targets

**Content/use:** Gene attributes, drug mechanisms and disease associations; useful chemical normalization and evidence. Local release 26.09 includes target/drug/pathway/disease data and explicit CRISPR evidence tables. Some local aggregate features use `association_overall_direct`.

**Rights:** Official platform data are marked CC0, with contributor agreements described on the licensing page. Preserve platform version and attribution. Direct downloads from a contributing source require that source's own terms. [Official license](https://platform-docs.opentargets.org/licence).

**Risk/quality/cost:** Both direct CRISPR evidence and aggregated associations can reflect target experiments; absence of an ORCS ID does not prove independence. Record contributing evidence source and publication dates. Mechanism annotations are not direct predictions of perturbation phenotype. Local 1.3 GB; select a few fields/partitions with DuckDB, and exclude all contaminated evidence from strict historical experiments.

### HGNC, Ensembl and UniProt

**Content/use:** Identifier mapping, genome/transcript coordinates, protein sequence/function. Essential shared infrastructure for both tracks; identity normalization itself must not add target labels.

**Versions/rights:** HGNC declares CC0; keep a dated complete set rather than a mutable current file. Ensembl-generated data have no project-imposed use restrictions, with third-party exceptions; code licensing is separate. UniProt's official API page states CC BY 4.0 for copyrightable database content. [HGNC license](https://www.genenames.org/about/license/), [Ensembl disclaimer](https://sep2025.archive.ensembl.org/info/about/legal/disclaimer.html), [UniProt official documentation](https://www.uniprot.org/api-documentation/support-data).

**Compatibility/risk/cost:** Keep stable IDs, original symbols, alias ambiguity status, species, assembly accession and transcript version. Genome coordinate conventions and GRCh37/GRCh38 must never be mixed silently. Gene renames can be corrected using a declared map, but current functional annotations introduce future knowledge. Local annotation 266 MB; compact mapping tables are cheap.

### MSigDB

**Content/use:** Gene sets for interpretation and experimental diversity. A gene-set collection is not an independent validation dataset. Overlapping sets can overstate apparent pathway diversity.

**Rights/version:** Release and subcollection matter. The post-April-2017 license page distinguishes its Creative Commons material from additional KEGG and BioCarta terms; older versions use older terms. Do not treat all C2 collections as freely redistributable because a package can download them. The benchmark does not bundle restricted collections. [MSigDB license](https://www.gsea-msigdb.org/gsea/msigdb_license_terms.jsp), [license history](https://docs.gsea-msigdb.org/MSigDB/Release_Notes/MSigDB_6.0/).

**Risk/cost:** Many signatures derive from experiments; remove target-derived sets and use historical releases. A selected GMT is small, but each set needs source and license attribution. No new MSigDB bulk download was initiated.

### ChEMBL and DGIdb

**Content/use:** Structures, synonyms, target activity and drug–gene claims for chemical-context modeling. Local DGIdb has 98,240 lines according to its manifest; Open Targets includes ChEMBL-derived molecules/mechanisms.

**Rights/version:** Direct ChEMBL data use CC BY-SA 3.0 with release attribution. DGIdb software's MIT license does not establish blanket rights to aggregated upstream claims. Store claim-level source, access path and version; the local `latest/interactions.tsv` is hash-pinned but its release chronology needs resolving. [ChEMBL official licensing explanation](https://chembl.github.io/chembl-licensing/), [DGIdb downloads](https://dgidb.org/downloads).

**Quality/risk/cost:** Distinguish compounds, salts, combinations, target families and direction of action. Potency measurements need units and relation operators. Molecular similarity is not equivalence. Later target annotations may arise from the held-out study. Existing 12 MB DGIdb and selected Open Targets fields are sufficient for small experiments; full ChEMBL is not necessary initially.

### Public perturbational/transcriptomic resources and literature

**Content/use:** MorPhiC/Perturb-seq can support expression representations and response models, while PubTator supports entity links and dated literature features. Local MorPhiC manifests and checksums are present; `literature` and `morphic` occupy 3.1 and 6.2 GB. These resources are not already a clean independent validation-success cohort.

**Quality/rights:** Record accession, experimental modality, processed/raw status, control definition, cell identity, donor relationships and file-specific license. Repository notes call a MorPhiC release CC BY 4.0, but no blanket redistribution conclusion for every local file is established here. PubTator entity annotations do not grant redistribution rights to all linked full texts; article rights differ. Date literature evidence by underlying publication and available version, not just download date.

**Contamination:** Full-text/abstract gene descriptions can directly report target results. Global publication counts include future studies and favor well-studied genes. Removing target PMIDs is necessary but insufficient when reviews, preprints and overlapping cohorts remain. Dataset-specific raw experiment accession deduplication is preferable to publication-only exclusion.

### Independent validation and private customer outcomes

**Content/use:** Actual independent positive, negative and inconclusive validations are the required labels for validation-success calibration. Published selective validation, technical replication and an inferred common-essential set are different endpoints.

**Availability/rights:** No representative independently governed validation-outcome cohort was established by this audit. Private outcomes need laboratory authorization for each use: operational analysis, aggregate evaluation, model training and external sharing. Record consent version, scope and revocation handling; do not inherit public-data permissions.

**Cost/provenance:** Structured metadata/outcomes are small; source assay files may be large. Retain an immutable prediction timestamp/hash before outcome reveal, original assay evidence, laboratory/study groups, selection reasons and identity of the outcome custodian.

## 4. Confirmed provenance weaknesses in existing documentation

1. `string/SOURCES.txt`, `reactome/SOURCES.txt` and `derived/SOURCES.txt` use “no CRISPR hit calls” as an argument for being label-free. This does not establish temporal or informational independence.
2. `opentargets/SOURCES.txt` excludes explicit CRISPR tables but includes aggregate associations. Their contributing evidence requires inspection before a clean-history claim.
3. `features/depmap.py` acknowledges overlap with ORCS-derived experiments and excludes some self-measured rows, but a modern aggregate can still contain future/related information. That module's experiment claims do not certify historical deployment.
4. Existing documentation sometimes calls a source “current” without a frozen release manifest. Preserve hashes, but also establish publication/release dates.
5. Broad dependency panels and multiple directional variants reduce effective independent sample size. Screen-level bootstrap alone can overstate certainty.
6. A public test already analyzed in historical fusion scripts cannot become untouched again by renaming a split or changing the model family.

These are scientific boundary findings, not assertions that every existing feature is unusable. Modern-knowledge retrospective experiments remain useful when clearly labeled and compared fairly.

## 5. Required provenance contract for reproducible experiments

For each artifact record `source_uri`, provider, release, retrieval UTC, source checksum, schema checksum, license URL/snapshot, permitted purpose, redistribution status, species, assembly, identifier map version, original study/accession IDs, earliest availability date, pipeline revision and parent artifacts. Derived caches should inherit all parents, not erase restricted provenance.

For each experiment record the allowed input fields, training studies, excluded studies, cutoff, candidate-universe policy, external feature releases, estimator selection folds and frozen prediction hash. Distinguish missing measurement, measured non-hit, opposite-direction hit and ambiguous identifier in storage.

Suggested operational controls, not all implemented by this document: immutable object keys, separate public/private buckets, customer-level access controls, manifest validation on load, cache invalidation on changed source hash, and export allowlists that carry licenses. These controls should be tested before relying on them in a product claim.

## 6. Prospective evaluation access protocol

Freeze model/configuration and issue signed/hash-addressed prediction artifacts before an independent steward accepts validation outcomes. Register studies, dates, eligibility, candidate set and available metadata without exposing answers to developers. Keep all related assays and donor lines together. Report all eligible screens, including failures and abstentions. Permit one final evaluation after the declared freeze; later model changes start a new version and future cohort.

No prospective laboratory results were acquired in this audit. The access protocol is a foundation for future independent evidence, not proof of generalization already achieved.
