# SplicR test data — one real pooled CRISPR KO screen with raw reads

A single small, published, genome-wide pooled CRISPR-Cas9 knockout screen with **raw
amplicon FASTQ reads** plus the **authors' own published count table**, so the SplicR
counting pipeline can be tested end to end and checked against a reference.

Everything here came from public archives (ENA read mirror, NCBI GEO FTP).
No login, no dbGaP, no SRA toolkit.

**Total: 21 files, 3,238,110,546 bytes (3.02 GB). 12 FASTQ runs, 92,446,492 reads.**

---

## The screen

| | |
|---|---|
| **GEO series** | [GSE145743](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE145743) (public 2020-08-01) |
| **BioProject** | PRJNA608032 |
| **SRA study** | SRP250346 |
| **Series title** | Genome-wide CRISPR knockout screen using GeCKO v2 to identify synthetic lethal interactions with the PARP inhibitor Olaparib |
| **Paper** | Juhász S, Smith R, Schauer T, Spekhardt D, Mamar H, Zentout S, Chapuis C, Huet S, Timinszky G. *The chromatin remodeler ALC1 underlies resistance to PARP inhibitor treatment.* **Sci Adv** 2020;6(51):eabb8626. |
| **PMID / PMCID / DOI** | 33355125 / PMC11206534 / [10.1126/sciadv.abb8626](https://doi.org/10.1126/sciadv.abb8626) |
| **Platforms** | GPL18460, GPL28978 (Illumina HiSeq 1500) |
| **Cell line** | HeLa stably expressing mCAT1 |
| **Screen type** | Pooled CRISPR-Cas9 knockout, chemogenomic (drug vs vehicle) plus a Day-0 dropout arm |
| **Paper's hit** | **CHD1L / ALC1** — loss sensitises cells to olaparib |

Article identification is from PubMed; the GEO record itself carries no PubMed link, so
the paper was matched by title, contributors (Smith, Schauer, Timinszky) and screen design.
GEO's own record supplies the BioProject and SRA cross-references above.

### Design, as described in the paper's Methods

HeLa-mCAT1 transduced with the GeCKOv2 lentiviral library at MOI 0.3, puromycin-selected
(0.3 µg/ml) for 7 days, then split into **five replicates**: one collected immediately as
the **input** sample, two cultured with **DMSO**, two with **3 µM olaparib**, for 14 days.
That is 5 gDNA samples per half-library, plus one plasmid-pool run per half-library
→ 6 runs × 2 half-libraries = the 12 runs here.

### Library

**Human GeCKO v2**, half-libraries A and B, prepared and sequenced separately
(Sanjana, Shalem & Zhang 2014, [doi:10.1038/nmeth.3047](https://doi.org/10.1038/nmeth.3047)).

Library definition files already in this repo:

| file | sgRNA rows | distinct 20-mers |
|---|---|---|
| `data/references/libraries/geckov2-a.csv` | 65,383 | 63,950 |
| `data/references/libraries/geckov2-b.csv` | 58,028 | 56,869 |
| **A + B** | **123,411** | — |

**Verified:** the sgRNA IDs in the published count table and the IDs in these two files are
the *same set* — 123,411 shared, 0 only in the table, 0 only in the library. A + B in this
repo is the correct and complete reference for these FASTQs.

> `geckov2-a.csv` / `geckov2-b.csv` use **bare CR** line endings — `wc -l` reports 0.
> Count rows with `tr '\r' '\n' < file | grep -c .`.

#### Guide sequences are not unique — this matters for counting

All 123,411 guides are exactly 20 nt and pure ACGT, but sequences repeat:

| | library A | library B |
|---|---|---|
| rows | 65,383 | 58,028 |
| distinct sequences | 63,950 | 56,869 |
| sequences appearing on >1 row | 1,016 | 744 |
| **sequences assigned to >1 gene** | **996** | **744** |
| sequences present in *both* A and B | 1,358 | 1,358 |

So a plain sequence → sgRNA-ID lookup is **ambiguous for ~1,400 rows per half-library**.
Decide explicitly whether to drop, duplicate or first-match these, and count A and B
against their own reference — never pool a libA FASTQ against `geckov2-b.csv`.

---

## Sample layout

`GSE145743/fastq/<run>_<label>.fastq.gz`. Machine-readable version:
`GSE145743/metadata/sample_sheet.tsv` (run, GSM, experiment, GEO title, half-library, arm,
replicate, role, matching library file, FASTQ path, read count, bytes, MD5).

GSM→SRX is from the GEO record; SRX→SRR from the ENA report. Both were cross-checked.

| run | GSM | arm | half | role | reads |
|---|---|---|---|---|---|
| SRR12401850 | GSM4712439 | `libA_plasmid` | A | plasmid pool, pre-transduction | 3,119,503 |
| SRR11144449 | GSM4332020 | `libA_T0_input` | A | **T0 / input, Day 0** (dropout reference) | 12,449,815 |
| SRR11144453 | GSM4332024 | `libA_DMSO_rep1` | A | vehicle, Day 14, rep 1 | 5,896,213 |
| SRR11144450 | GSM4332021 | `libA_DMSO_rep2` | A | vehicle, Day 14, rep 2 | 14,638,915 |
| SRR11144451 | GSM4332022 | `libA_olaparib_rep1` | A | 3 µM olaparib, Day 14, rep 1 | 4,871,170 |
| SRR11144452 | GSM4332023 | `libA_olaparib_rep2` | A | 3 µM olaparib, Day 14, rep 2 | 7,380,260 |
| SRR12401851 | GSM4712440 | `libB_plasmid` | B | plasmid pool, pre-transduction | 2,922,599 |
| SRR11144454 | GSM4332025 | `libB_T0_input` | B | **T0 / input, Day 0** (dropout reference) | 6,919,415 |
| SRR11144457 | GSM4332028 | `libB_DMSO_rep1` | B | vehicle, Day 14, rep 1 | 10,756,303 |
| SRR11144458 | GSM4332029 | `libB_DMSO_rep2` | B | vehicle, Day 14, rep 2 | 9,044,856 |
| SRR11144455 | GSM4332026 | `libB_olaparib_rep1` | B | 3 µM olaparib, Day 14, rep 1 | 11,355,013 |
| SRR11144456 | GSM4332027 | `libB_olaparib_rep2` | B | 3 µM olaparib, Day 14, rep 2 | 3,092,430 |

Two independent comparisons:

* **dropout / essentiality:** `T0_input` → `DMSO`. Use with
  `data/references/genesets/CEGv2.txt` and `NEGv1.txt` for QC and BAGEL2.
* **chemogenomic:** `DMSO` → `olaparib`. Expected hit **CHD1L / ALC1** (sensitising).

---

## Read structure

Single-end, forward orientation only (the authors aligned with `--norc`).

```
NTTGTGGAAAGGACGAAACACCG CTCCCCTGCAGGCCGTGGTT GTTTTAG...
|<--- vector / U6 3' --->|<--- 20 nt sgRNA --->|<- scaffold ->|
0                     22 23                 42 43
```

* **5' constant adapter:** `GGACGAAACACCG` — the exact `cutadapt -g` sequence the authors
  used. The guide begins immediately after it.
* **sgRNA length:** 20 nt.
* **Guide offset is 23 (0-based) in all 12 runs**, gDNA and plasmid alike — the modal
  offset measured over the first 100,000 reads of every file is 23 with no exceptions.
  Trimming on the adapter is still the safer default, but the layout is in fact fixed.

### Read length is NOT uniform — 9 runs are 50 bp, 3 are 100 bp

| runs | read length | full tracrRNA present? |
|---|---|---|
| SRR12401850, SRR12401851 (both plasmid), SRR11144454 (libB T0 input) | 100 bp | yes, 89–93% of reads |
| the other 9 runs | 50 bp | **no — 0.1–0.2% of reads** |

This is a trap. The guide ends at base 43, so a 50 bp read has only **7 bp** of scaffold
(`GTTTTAG`) and *cannot* contain the 23-mer `GTTTTAGAGCTAGAAATAGCAAG`. Using the full
tracrRNA as a "is this really an sgRNA amplicon?" gate would reject 9 of the 12 runs.
Use `GTTTTAG` — or better, the 5' adapter — for that check instead.

### Measured per-file (first 100,000 reads of each)

| run | len | % with 5' adapter | % whose 20-mer is in its library | % with full tracr |
|---|---|---|---|---|
| SRR12401850 libA plasmid | 100 | 92.8 | 77.7 | 91.0 |
| SRR11144449 libA T0 | 50 | 96.3 | 79.3 | 0.1 |
| SRR11144453 libA DMSO1 | 50 | 97.1 | 76.6 | 0.2 |
| SRR11144450 libA DMSO2 | 50 | 97.2 | 78.2 | 0.2 |
| SRR11144451 libA olap1 | 50 | 97.1 | 78.2 | 0.2 |
| SRR11144452 libA olap2 | 50 | 97.8 | 79.0 | 0.2 |
| SRR12401851 libB plasmid | 100 | 91.7 | 78.7 | 92.6 |
| SRR11144454 libB T0 | 100 | 96.6 | 81.2 | 88.9 |
| SRR11144457 libB DMSO1 | 50 | 96.5 | 78.2 | 0.2 |
| SRR11144458 libB DMSO2 | 50 | 96.4 | 77.9 | 0.1 |
| SRR11144455 libB olap1 | 50 | 96.5 | 79.3 | 0.1 |
| SRR11144456 libB olap2 | 50 | 97.1 | 79.9 | 0.1 |

**~92–98% of reads carry the adapter and ~77–81% yield a 20-mer that is an exact member of
that run's own half-library.** That is a real, independent confirmation that these files
are GeCKOv2 sgRNA amplicons and that they are paired with the right reference.
Treat ~77% exact-match as the rough baseline your counter should reach; note every read
begins with an `N` at position 0, so do not discard reads on a leading N.

### Authors' own processing, from the GEO records

1. `cutadapt` 1.16, `-g GGACGAAACACCG -l 20` on 50 bp single reads
2. `bowtie2` 2.3.4.1 `--norc`, against Human GeCKOv2 library A or B **separately**
3. `samtools` 1.7 `-q 2`
4. counted per sgRNA, **subsampled to 5,000,000 reads with replacement**, then A and B
   from the same sample merged into one table

---

## Published count table

`GSE145743/counts/GSE145743_my_counts_anno_merged.txt.gz` — the series' only
supplementary file (GEO FTP `suppl/` contains nothing else).

Tab-delimited, 123,412 lines (1 header + 123,411 sgRNAs), 21,915 distinct gene symbols,
split 65,383 `HGLibA_*` + 58,028 `HGLibB_*`:

```
sgRNA	GENE	DMSO1	DMSO2	input	Olaparib1	Olaparib2	plasmid
HGLibA_00001	A1BG	94	35	116	46	28	65
```

**These columns are not raw counts of the FASTQs in `fastq/`:**

* half-libraries A and B were counted separately then **merged into one column per
  condition**, so `DMSO1` covers `SRR11144453` (A) **and** `SRR11144457` (B);
* each sample was **subsampled to 5 M reads with replacement** before counting;
* there are 6 columns for 12 runs.

Absolute counts will not match. What should match:

* the 123,411 sgRNA IDs and their gene assignments (already verified identical to the
  library files in this repo);
* **rank correlation** of per-sgRNA counts within a condition, once you merge A+B and
  normalise depth (expect Spearman well above 0.9);
* the direction and relative magnitude of the log-fold changes, and the CHD1L hit.

---

## Files

| path (under `data/testdata/`) | bytes |
|---|---|
| `README.md` | 12,885 |
| `GSE145743/counts/GSE145743_my_counts_anno_merged.txt.gz` | 1,531,146 |
| `GSE145743/fastq/SRR11144449_libA_T0_input.fastq.gz` | 440,464,023 |
| `GSE145743/fastq/SRR11144450_libA_DMSO_rep2.fastq.gz` | 625,914,860 |
| `GSE145743/fastq/SRR11144451_libA_olaparib_rep1.fastq.gz` | 152,325,251 |
| `GSE145743/fastq/SRR11144452_libA_olaparib_rep2.fastq.gz` | 206,528,330 |
| `GSE145743/fastq/SRR11144453_libA_DMSO_rep1.fastq.gz` | 279,026,701 |
| `GSE145743/fastq/SRR11144454_libB_T0_input.fastq.gz` | 220,895,031 |
| `GSE145743/fastq/SRR11144455_libB_olaparib_rep1.fastq.gz` | 362,734,471 |
| `GSE145743/fastq/SRR11144456_libB_olaparib_rep2.fastq.gz` | 155,899,105 |
| `GSE145743/fastq/SRR11144457_libB_DMSO_rep1.fastq.gz` | 302,811,576 |
| `GSE145743/fastq/SRR11144458_libB_DMSO_rep2.fastq.gz` | 285,675,243 |
| `GSE145743/fastq/SRR12401850_libA_plasmid.fastq.gz` | 105,266,536 |
| `GSE145743/fastq/SRR12401851_libB_plasmid.fastq.gz` | 98,675,891 |
| `GSE145743/metadata/sample_sheet.tsv` | 3,251 |
| `GSE145743/metadata/ena_filereport_PRJNA608032.tsv` | 3,001 |
| `GSE145743/metadata/GSE145743_geo_brief.txt` | 332,216 |
| `GSE145743/metadata/GSE145743_family.soft.gz` | 2,989 |
| `GSE145743/metadata/GSE145743_family.xml.tgz` | 3,389 |
| `GSE145743/metadata/GSE145743-GPL18460_series_matrix.txt.gz` | 2,508 |
| `GSE145743/metadata/GSE145743-GPL28978_series_matrix.txt.gz` | 2,143 |

FASTQ subtotal 3,236,217,018 B. All files 3,238,110,546 B (3.02 GB).

---

## How each file was verified

* `curl -fL --retry 3 --connect-timeout 30` — non-2xx and truncated transfers fail hard.
* **Every FASTQ's MD5 matches the ENA `fastq_md5` field, and every byte size matches
  `fastq_bytes` — 12/12 on both.** MD5 agreement is a complete integrity proof, so the
  per-run `read_count` in the sample sheet is taken from ENA rather than recounted.
* `gzip -t` passes on all 13 `.gz` files; `tar -tzf` on the `.tgz`.
* First 400,000 lines of each FASTQ decompressed = exactly 100,000 whole records.
* Read length, 5' adapter rate, guide offset, exact library-membership rate and tracrRNA
  rate measured per file (table above).
* Count table: `gzip -t`, header inspected, 123,412 rows, and its sgRNA ID set compared
  element-by-element against `geckov2-a.csv` + `geckov2-b.csv` (exact match, 0 differences).

Re-run the integrity check at any time:

```sh
cd data/testdata/GSE145743
for f in fastq/*.fastq.gz; do
  acc=$(basename "$f" | cut -d_ -f1)
  exp=$(awk -F'\t' -v a="$acc" '$1==a{print $9}' metadata/ena_filereport_PRJNA608032.tsv)
  [ "$exp" = "$(md5 -q "$f")" ] && echo "md5 ok   $acc" || echo "MD5 FAIL $acc"
  gzip -t "$f" || echo "GZIP FAIL $acc"
done
```

---

## Provenance and reuse

* **FASTQ:** ENA read mirror, `https://ftp.sra.ebi.ac.uk/vol1/fastq/...` (ENA mirror of
  SRA study SRP250346). Public, unauthenticated.
* **Count table and GEO metadata:** NCBI GEO FTP, `geo/series/GSE145nnn/GSE145743/`. Public.
* NCBI GEO and ENA place no additional restrictions on redistribution of submitted
  sequence data. Cite Juhász et al. 2020 (PMID 33355125,
  [doi:10.1126/sciadv.abb8626](https://doi.org/10.1126/sciadv.abb8626)) when using it.
