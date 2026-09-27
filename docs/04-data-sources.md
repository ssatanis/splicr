# Data sources

`bash scripts/data/download.sh` fetches everything below into
`data/references`. Nothing here is committed to the repository.

## What downloads

| File | Source | Size | Licence | Redistribute |
|---|---|---|---|---|
| `annotation/hgnc_complete_set.txt` | HGNC | 16 MB | CC0 | Yes |
| `annotation/human_mouse_hcop.txt.gz` | HGNC HCOP | 3.3 MB | CC0 | Yes |
| `annotation/*.gene_info.gz` | NCBI Gene | 8.6 MB | Public domain | Yes |
| `annotation/*.gtf.gz` | Ensembl 116 | 238 MB | No restrictions on data | Yes |
| `genesets/CEGv2.txt`, `NEGv1.txt`, mouse sets | Hart lab | 43 KB | Open | Yes |
| `cells/cellosaurus.txt` | Cellosaurus 56.0 | 117 MB | CC BY 4.0 | Yes |
| `cells/sanger_model_list.csv.gz` | Cell Model Passports | 142 KB | Internal research only | **No** |
| `libraries/*.txt`, `*.csv`, `*.xlsx` | Addgene / Broad GPP | 24 MB | Terms of use | **No** |
| `opentargets/*.parquet` | Open Targets 26.09 | 1 MB | CC0 | Yes |
| `orcs/*.tar.gz` (`--all`) | BioGRID ORCS 2.0.18 | 718 MB | MIT | Yes |
| DepMap 26Q1 (`--all`, needs an id) | Broad DepMap | GBs | CC BY 4.0 | Yes, with attribution |

**Three sources may not be redistributed.** Addgene forbids reproducing their
content commercially. Sanger's Project Score is licensed for internal research
and explicitly not for resale, even combined with other data. COSMIC needs a
paid commercial licence. Plan any public Atlas export so values derived from
these are recomputed locally rather than shipped.

## Verified counts

Checked against the downloaded files, not the documentation:

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

**BioGRID ORCS rate-limits and does not resume.** It answers a throttled
request with a 17-byte `error code: 1015` body under a 200 status, and it
ignores `Range`, so a truncated 718 MB transfer must restart from zero.
`scripts/data/fetch-orcs.sh` retries until the gzip stream validates.

**SourceForge cannot be scripted.** MAGeCK's library mirror serves a 142 KB
HTML interstitial to non-browser clients, then a bot challenge. Use Addgene.

**DepMap is bot-gated.** Get the release's Figshare id from the portal in a
browser, then set `DEPMAP_FIGSHARE_ID` and re-run with `--all`. Note the
Figshare file listing needs `?page_size=500` or it silently returns 10 of 73
files.

## Version pins

- HGNC: refreshed Tuesdays and Fridays. Pin a quarterly archive for
  reproducibility; monthly files older than a year are deleted.
- Ensembl: release 116 is the last numbered release. Newer data is
  date-versioned, and filenames no longer carry the assembly, so record the
  accession yourself.
- DepMap: 26Q1 changed Chronos library correction, so gene effects differ from
  25Q3. Never mix releases inside one Atlas build.
- BioGRID ORCS: 2.0.18 dated September 2025 is current.

## One caution about ORCS

ORCS applies the original authors' own hit thresholds, and `SCORE.1` has no
fixed meaning: across screens it is variously a p-value, an FDR, a Z-score, a
log fold change or a Bayes factor, with opposite sign conventions. Always join
`SCORE.n_TYPE` from the screen index. This heterogeneity is precisely what
re-analyzing every screen through one pipeline is meant to fix.
