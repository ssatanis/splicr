# Data sources

`bash scripts/data/download.sh` attempts reference downloads into
`data/references`; large archives require `--all`, and gated sources can require
manual retrieval. Large reference files are ignored. This document retains
historical ingestion observations; current provenance and licensing limitations
are in [the data audit](../research/04_DATA_AUDIT.md). Source-specific terms and
file manifests take precedence over shorthand in this table.

## What downloads

| File | Source | Size | Licence | Redistribute |
|---|---|---|---|---|
| `annotation/hgnc_complete_set.txt` | HGNC | 16 MB | CC0 | Yes |
| `annotation/human_mouse_hcop.txt.gz` | HGNC HCOP | 3.3 MB | CC0 | Yes |
| `annotation/*.gene_info.gz` | NCBI Gene | 8.6 MB | Public domain | Yes |
| `annotation/*.gtf.gz` | Ensembl 116 | 238 MB | No restrictions on data | Yes |
| `genesets/CEGv2.txt`, `NEGv1.txt`, mouse sets | Hart lab | 43 KB | Record exact file/repository terms | Review |
| `cells/cellosaurus.txt` | Cellosaurus 56.0 | 117 MB | CC BY 4.0 | Yes |
| `cells/sanger_model_list.csv.gz` | Cell Model Passports | 142 KB | Internal research only | **No** |
| `libraries/*.txt`, `*.csv`, `*.xlsx` | Addgene / Broad GPP | 24 MB | Terms of use | **No** |
| `opentargets/*.parquet` | Open Targets 26.09 | 1 MB | CC0 | Yes |
| `orcs/*.tar.gz` (`--all`) | BioGRID ORCS 2.0.18 | 718 MB | MIT | Yes |
| `depmap/*.csv` (DepMap 24Q4) | Broad DepMap | 3.6 GB | File-specific; local release licence recorded | Review each file |
| `depmap/26Q1/*.csv` (Chronos only) | Broad DepMap | 444 MB | File-specific; do not extend to third-party portal data | Review each file |

**Public access is not unrestricted commercial permission.** Addgene content
and library-specific terms require review. Direct Sanger Project Score/Cell Model
Passports data permit internal proprietary research under their policy but
restrict resale, commercial services and direct third-party API access without
consent. COSMIC has separate commercial licensing. Recomputing a derived value
locally does not automatically remove source restrictions. Open Targets has its
own data agreements; do not transfer its licence to a direct Sanger download.
See the [Sanger policy](https://depmap.sanger.ac.uk/documentation/data-usage-policy/)
and [Open Targets licence](https://platform-docs.opentargets.org/licence).

## Source registry (2026-09-29)

The authoritative list is `engine/splicr/sources.py`; print it with
`python -m splicr sources` (or `--json`). The same rows are loaded into
`atlas.data_sources` and served as `public.data_sources`. Each source carries a
literal `status`: `lake` (harmonized Parquet, on R2), `local`, `remote`
(queried in place), `cataloged` (metadata only), `manual` (browser-gated),
`controlled` (dbGaP) or `unreachable`.

| Added | Status | Lake datasets | Connector |
|---|---|---|---|
| DepMap Public 26Q1 (full portal release) | lake | `depmap_matrix`, `depmap_models`, `depmap_raw_readcounts`, 7 map/QC tables | `scripts/data/build-depmap-lake.py` |
| JUMP Cell Painting cpg0016 | lake | `jump_perturbations`, `jump_{crispr,orf}_gene_morphology` | `ingest-sources.py jump` |
| Replogle 2022 Perturb-seq (K562 gwps, RPE1) | lake | `perturbseq_*_signatures`, `perturbseq_*_readout_genes` | `ingest-sources.py perturbseq` |
| Tahoe-100M | metadata in lake; cells remote | `tahoe_drugs`, `tahoe_cell_lines`, `tahoe_samples` | `ingest-sources.py tahoe` |
| scBaseCount 2026-01-12 | cataloged | `scbasecount_samples` | `ingest-sources.py scbasecount` |
| LINCS L1000 GSE70138 | cataloged | `lincs_signatures` | `ingest-sources.py lincs` |
| NCBI GEO CRISPR screens | cataloged (watch list) | `geo_crispr_series` | `ingest-sources.py geo` |
| ENCODE functional characterization | cataloged | `encode_functional_screens` | `ingest-sources.py encode` |
| Knowledge graph (STRING, Reactome, Open Targets, DepMap, Tahoe) | lake | `kg_nodes`, `kg_edges` | `engine/splicr/graph.py` |

Not ingested, and why: TCGA and GTEx raw reads need dbGaP approval; iCSDB and
GenomeCRISPR offer no bulk export (browser only); CRISP-view did not answer on
2026-09-29; the Tahoe cell matrices (~300 GB), JUMP TIFFs (~116 TB) and
scPerturb h5ad files (43 GB) exceed this workstation's disk and are read in
place or replaced by the authors' own compact derivatives.

**Licences.** JUMP, Tahoe-100M and scBaseCount are CC0; DepMap, Replogle,
scPerturb, STRING, Reactome and Cellosaurus are CC BY 4.0 (attribute on any
redistributed copy); LINCS and GEO follow NCBI/LINCS release policy. None of the
added sources carries the no-redistribution terms that keep Project Score and
Addgene files off R2.

**DepMap 26Q1 value warning.** The portal's `CRISPRGeneEffect.csv` and the
Figshare 26Q1 `gene_effect.csv` cover the same 1,208 models but are different
processing stages (KRAS r = 0.974 between them). The lake uses the portal file.

## Verified counts

Historical checks against the then-downloaded files, not guarantees for a new
release. Recheck the manifest and identifiers when refreshing data:

| Thing | Expected | Got |
|---|---|---|
| CEGv2 core essentials | 684 | 684 |
| NEGv1 nonessentials | 927 | 927 |
| Cellosaurus cell lines | 168,970 | 168,970 |
| HGNC columns | 53 | 53 |
| Brunello rows | 77,441 | 77,441 |
| Brie rows | 78,637 | 78,637 |
| Gattinara rows | 40,964 | 40,964 |
| Calabrese A / Dolcetto A | 56,762 / 57,050 | 56,762 / 57,050 |

## Gotchas that cost real time

**Bare CR line endings.** Brunello, Brie and both GeCKOv2 files use `\r` alone.
`wc -l` returns 0 and naive splitting yields one enormous line. Normalize with
`replace(/\r\n?/g, "\n")` before parsing.

**Addgene URLs are opaque.** There is no predictable pattern: files live under
a UUID path. A near-miss returns an S3 `AccessDenied` XML body that a naive
downloader happily saves as a library file. The downloader checks size and
content before accepting.

**Two different Broad GPP schemas.** Brunello and Brie have 11 columns with
coordinates. Gattinara, Calabrese and Dolcetto have 3 columns and no
coordinates. There is no single "GPP format".

**Historical BioGRID ORCS download failures.** The four smaller
species download cleanly. The 718 MB human archive was truncated on all 27
attempts, at points from 28 MB to 105 MB, and capping the rate at 2 MB/s made
no difference. The host also ignores `Range`, so nothing resumes. ORCS
separately answers throttled requests with a 17-byte `error code: 1015` body
under a 200 status, which a naive downloader will happily save as a `.tar.gz`.

Fetch the human file in a browser from
https://downloads.thebiogrid.org/BioGRID-ORCS and move it to
`data/references/orcs/orcs-human.tar.gz`. Everything downstream validates the
gzip stream before reading it, so a partial file fails loudly rather than
silently producing a short Atlas.

**Historical SourceForge download failures.** MAGeCK's library mirror serves a 142 KB
HTML interstitial to non-browser clients, then a bot challenge. Use Addgene.

**DepMap is bot-gated.** Get the release's Figshare id from the portal in a
browser, then set `DEPMAP_FIGSHARE_ID` and re-run with `--all`. Note the
Figshare file listing needs `?page_size=500` or it silently returns 10 of 73
files.

## Version pins

- HGNC: refreshed Tuesdays and Fridays. Pin a quarterly archive for
  reproducibility; monthly files older than a year are deleted.
- Ensembl: the downloader specifies release 116. Record the release, assembly
  accession, annotation build and checksum; do not infer them from a filename
  or assume this pinned release is current.
- DepMap: this checkout uses 24Q4 and a separately obtained 26Q1 Chronos
  file. This is a local inventory, not a claim about the newest public release.
  Portal challenges can return HTML with HTTP 200; validate content before use. The
  engine reads common essentials and copy number from the 24Q4 files. The two
  releases have different gene and model sets (18,531 and 1,208 for 26Q1
  against 17,916 and 1,178 for 24Q4), so never join them without reindexing on
  the intersection. See `depmap/26Q1/SOURCES.txt`.
- BioGRID ORCS: the archived local source is 2.0.18. Record the downloaded
  archive hash and release date rather than treating “current” as a version.

## One caution about ORCS

ORCS applies the original authors' own hit thresholds, and `SCORE.1` has no
fixed meaning: across screens it is variously a p-value, an FDR, a Z-score, a
log fold change or a Bayes factor, with opposite sign conventions. Always join
`SCORE.n_TYPE` from the screen index. Uniform reanalysis could address some heterogeneity where raw counts and
designs exist, but SplicR has not reprocessed the entire Atlas. Original scores
and source thresholds must remain inspectable.

## Sources to add next

Earlier candidates for further investigation; not implemented data integrations.
Availability, historical releases and licensing must be rechecked before use.

| Source | Why | Access |
|---|---|---|
| **MorPhiC v4.0** | Pooled Perturb-seq, manifest-indexed, CC BY 4.0, no embargo | `ftp.ebi.ac.uk/pub/databases/morphic/`, raw reads at ENA `PRJEB81155` (1,925 runs) |
| **PubTator3 bulk** | Biomedical annotations; underlying article/abstract reuse has separate rights | `ftp.ncbi.nlm.nih.gov/pub/lu/PubTator3/` |
| **GenomeCRISPR** | 84 experiments, 48 human cell lines, frozen at 2017 but clean | `POST` to `genomecrispr.dkfz.de/api/experiments` |
| **iCSDB** | 1,375 screens harmonised to z-scores. A second precedent to compare against | `kobic.re.kr/icsdb/` |
| **ENCODE FCE** | `CRISPR screen` and `Flow-FISH CRISPR screen`, guide-level TSVs | GEO mirror; `encodeproject.org` returns 504s |

For literature mining, prefer **PubTator3's FTP over its REST API** at corpus
scale. Two API notes that will otherwise waste a day: Europe PMC's annotations
API is at `/europepmc/annotations_api/`, not under `/webservices/rest/`, which
404s. And **OpenAlex became metered and key-gated in February 2026**, so the
widely quoted 100k/day free tier no longer holds.

## Historical SRA discovery sample

The following exploration is retained as a local historical sample; it is not a
current census or a guaranteed storage forecast. A reproducible refresh needs
query text, accession list, retrieval date and per-file metadata.

### Discovering screens in SRA

Do not filter on one `library_strategy`. Across roughly 3,000 runs whose study
title matches CRISPR screen, the split is **POOLCLONE 1,001, WGS 875, AMPLICON
768, OTHER 162, RNA-Seq 125**. Querying AMPLICON alone, the obvious choice,
misses the largest single slice.

Per-run sizes are far smaller than the field assumes and heavy-tailed: the
AMPLICON median is roughly **8 to 12 million reads and 0.13 to 0.27 GB
gzipped**, with outliers past 170M reads. Budget against the distribution, not
an average.

### How much was deposited in that sample

Measured rather than assumed, on 80 random GEO series from the CRISPR-screen
hit list: 71% carry a count or guide file, but that number is carried almost
entirely by ENCODE-mirrored series. Among the **22 non-consortium series, only
41% have any count or sgRNA file**, and most of the remainder are not pooled
screens at all.

This small, query-dependent sample cannot establish a population-wide
deposition rate outside consortia. CRISP-view, which reprocessed 167 papers, states plainly that raw
data came from GEO, from paper supplements, *or from the author directly*.
Expect author contact to be part of Atlas growth, and treat any single headline
deposition percentage as an artefact of how the denominator was chosen.
