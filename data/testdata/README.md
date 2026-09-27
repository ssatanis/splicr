# SplicR test data — one real pooled CRISPR KO screen with raw reads

This folder holds a single small, published, genome-wide pooled CRISPR-Cas9 knockout
screen with **raw amplicon FASTQ reads** plus the **authors' own published count table**,
so the SplicR counting pipeline can be tested end to end and checked against a reference.

Everything here was downloaded from public archives (ENA read mirror, NCBI GEO FTP).
No login, no dbGaP, no SRA toolkit required.

---

## The screen

| | |
|---|---|
| **GEO series** | [GSE145743](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE145743) |
| **BioProject** | PRJNA608032 |
| **SRA study** | SRP250346 |
| **Title** | Genome-wide CRISPR knockout screen using GeCKO v2 to identify synthetic lethal interactions with the PARP inhibitor Olaparib |
| **Paper** | Juhász S, Smith R, Schauer T, Spekhardt D, Mamar H, Zentout S, Chapuis C, Huet S, Timinszky G. *The chromatin remodeler ALC1 underlies resistance to PARP inhibitor treatment.* **Science Advances** 2020;6(51):eabb8626. |
| **PMID** | 33355125 |
| **DOI** | [10.1126/sciadv.abb8626](https://doi.org/10.1126/sciadv.abb8626) |
| **Data availability (verbatim)** | "Sequencing data and analysis of the CRISPR screen with olaparib are deposited at Gene Expression Omnibus (GSE145743)." |
| **Cell line** | HeLa (stably expressing mCAT1) |
| **Screen type** | Pooled CRISPR-Cas9 knockout, chemogenomic (drug-vs-vehicle) with a Day-0 dropout arm |
| **Treatment** | 3 µM olaparib or DMSO for 14 days |
| **Replicates** | 2 biological replicates per arm |
| **Contributors** | Rebecca Smith, Tamás Schauer, Gyula Timinszky (Helmholtz Zentrum München / BRC Szeged) |

### Library

**Human GeCKO v2**, half-libraries A and B, sequenced separately
(Sanjana, Shalem & Zhang 2014, [doi:10.1038/nmeth.3047](https://doi.org/10.1038/nmeth.3047)).

The matching library definition files are already in this repo:

| file | sgRNAs |
|---|---|
| `data/references/libraries/geckov2-a.csv` | 65,383 |
| `data/references/libraries/geckov2-b.csv` | 58,028 |
| **A + B** | **123,411** |

The published count table below has exactly **123,411** sgRNA rows, so library A + B
in this repo is the correct and complete reference for these FASTQs.

> Note: `geckov2-a.csv` / `geckov2-b.csv` use **bare CR** line endings.
> `wc -l` reports 0. Count rows with `tr '\r' '\n' < file | grep -c .`.

---

## Sample layout

`fastq/<SRR accession>_<arm>.fastq.gz`

| run | GEO sample | arm | half-library | role in the screen |
|---|---|---|---|---|
| SRR12401850 | GSM4712439 | `libA_plasmid` | A | plasmid pool (library representation, pre-transduction) |
| SRR12401851 | GSM4712440 | `libB_plasmid` | B | plasmid pool (library representation, pre-transduction) |
| SRR11144449 | GSM4332020 | `libA_T0_input` | A | **T0 / input control, Day 0** (reference for dropout) |
| SRR11144454 | GSM4332025 | `libB_T0_input` | B | **T0 / input control, Day 0** (reference for dropout) |
| SRR11144453 | GSM4332024 | `libA_DMSO_rep1` | A | vehicle control, Day 14, rep 1 |
| SRR11144450 | GSM4332021 | `libA_DMSO_rep2` | A | vehicle control, Day 14, rep 2 |
| SRR11144457 | GSM4332028 | `libB_DMSO_rep1` | B | vehicle control, Day 14, rep 1 |
| SRR11144458 | GSM4332029 | `libB_DMSO_rep2` | B | vehicle control, Day 14, rep 2 |
| SRR11144451 | GSM4332022 | `libA_olaparib_rep1` | A | 3 µM olaparib, Day 14, rep 1 |
| SRR11144452 | GSM4332023 | `libA_olaparib_rep2` | A | 3 µM olaparib, Day 14, rep 2 |
| SRR11144455 | GSM4332026 | `libB_olaparib_rep1` | B | 3 µM olaparib, Day 14, rep 1 |
| SRR11144456 | GSM4332027 | `libB_olaparib_rep2` | B | 3 µM olaparib, Day 14, rep 2 |

Two independent comparisons are available:

* **dropout / essentiality:** `T0_input` → `DMSO` (14 days of growth).
  Use with `data/references/genesets/CEGv2.txt` and `NEGv1.txt` for QC and BAGEL2.
* **chemogenomic:** `DMSO` → `olaparib`. The paper's hit is **CHD1L / ALC1**
  (loss sensitises to olaparib); `PARP1` loss is the expected resistance direction.

Library A and library B are **separate** sequencing runs against **separate**
reference files. Do not pool a libA FASTQ against `geckov2-b.csv`.

---

## Read structure

Single-end. Forward orientation only — the authors aligned with `bowtie2 --norc`.

```
NTTGTGGAAAGGACGAAACACCG GGCCATAGCACTCGTGCAGC GTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCG...
|<---- vector / U6 3' ---->|<--- 20 nt sgRNA --->|<---------- tracrRNA scaffold ---------->|
```

* **5' constant adapter:** `GGACGAAACACCG` (this is the exact `cutadapt -g` sequence the
  authors used). The guide starts immediately after it.
* **sgRNA length:** 20 nt.
* **3' constant:** `GTTTTAGAGCTAGAAATAGCAAG` (tracrRNA scaffold) — a useful sanity
  check that a read really is an sgRNA amplicon.
* In the plasmid-pool runs the guide sits at a fixed 0-based offset of **23**.
  The gDNA runs are not fixed-offset; trim on the adapter rather than by position.

### Authors' own processing (for reference, from the GEO records)

1. `cutadapt` 1.16, `-g GGACGAAACACCG -l 20`
2. `bowtie2` 2.3.4.1, `--norc`, against Human GeCKOv2 library A or B separately
3. `samtools` 1.7 `-q 2` filter
4. counted per sgRNA, then **subsampled to 5,000,000 reads with replacement**,
   then library A and B merged into one table

---

## Published count table

`counts/GSE145743_my_counts_anno_merged.txt.gz`

Source: <https://ftp.ncbi.nlm.nih.gov/geo/series/GSE145nnn/GSE145743/suppl/GSE145743_my_counts_anno_merged.txt.gz>

Tab-delimited, 123,412 lines (1 header + 123,411 sgRNAs):

```
sgRNA	GENE	DMSO1	DMSO2	input	Olaparib1	Olaparib2	plasmid
HGLibA_00001	A1BG	94	35	116	46	28	65
HGLibA_00002	A1BG	56	45	54	38	40	60
```

**Important caveat when comparing SplicR counts to this table.** These columns are
*not* raw counts of the FASTQs in `fastq/`:

* half-libraries A and B were counted separately and then **merged into one column
  per condition**, so column `DMSO1` covers `SRR11144453` (A) **and** `SRR11144457` (B);
* each sample was **subsampled to 5 M reads with replacement** before counting.

So absolute counts will not match. What *should* match closely:

* the set of 123,411 sgRNA IDs and their gene assignments;
* the **rank correlation** of per-sgRNA counts within a condition (expect Spearman
  well above 0.9 against your own counts scaled to the same depth);
* the direction and relative magnitude of the log-fold changes, and the CHD1L hit.

---

## Files and verified sizes

<!--FILE_TABLE-->

---

## How each file was verified

* `curl -fL --retry 3 --connect-timeout 30` — non-2xx and truncated transfers fail hard.
* **MD5 checked against the ENA `fastq_md5` field** for every FASTQ
  (`data/testdata/GSE145743/metadata/ena_filereport_PRJNA608032.tsv`).
  Any mismatch deleted the file rather than keeping it.
* `gzip -t` on every `.gz`.
* First 400,000 lines decompressed and confirmed to be 100,000 whole FASTQ records.
* Modal read length measured over the first 100,000 reads.
* Fraction of the first 100,000 reads containing the tracrRNA scaffold
  `GTTTTAGAGCTAGAAATAGCAAG` measured, to confirm the reads are sgRNA amplicons and
  not something else.
* Count table: `gzip -t`, header inspected, row count taken with `tr '\r' '\n' | wc -l`.

Re-run the verification at any time:

```sh
cd data/testdata/GSE145743/fastq
for f in *.fastq.gz; do gzip -t "$f" && echo "gzip ok  $f"; done
# md5s to compare against:
cut -f1,9 ../metadata/ena_filereport_PRJNA608032.tsv
```

---

## Provenance / reuse

* FASTQ: ENA read mirror, `https://ftp.sra.ebi.ac.uk/vol1/fastq/...`
  (the ENA mirror of SRA study SRP250346). Public, no authentication.
* Count table: NCBI GEO FTP, series GSE145743 supplementary file. Public.
* NCBI GEO and ENA place no additional restrictions on redistribution of submitted
  sequence data; cite Juhász et al. 2020 (PMID 33355125) when using it.
