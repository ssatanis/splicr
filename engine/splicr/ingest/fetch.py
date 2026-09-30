"""
FASTQ retrieval and FastQC.

FASTQ comes from ENA over HTTPS, not from SRA with fasterq-dump. ENA mirrors
every SRA run as gzipped FASTQ with a published MD5 per file, so a download can
be verified byte for byte and resumed with a Range request; fasterq-dump needs
the SRA toolkit, scratch space three times the output, and gives no checksum.
A run whose FASTQ ENA has not generated yet (fresh deposits lag by a day or
two) is reported as not yet available rather than failed, and retried later.

Paired-end screens: the spacer sits in read 1 in every pooled-library protocol
SplicR supports, so only the _1 file is counted. Read 2 is still downloaded and
checked by FastQC when `with_mates` is set, for the record, but not counted.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

from .models import FastqcReport, RunRecord

UA = "SplicR-ingest/1.0 (mailto:ss4497@cornell.edu)"
CHUNK = 8 << 20


class NotYetAvailable(RuntimeError):
    """ENA lists the run but has not produced its FASTQ yet."""


class ChecksumMismatch(RuntimeError):
    pass


def _https(url: str) -> str:
    if url.startswith(("http://", "https://")):
        return url.replace("http://", "https://", 1)
    return "https://" + url.lstrip("/")


def download(url: str, dest: Path, md5: str | None = None, size: int | None = None, retries: int = 5) -> Path:
    """Stream to dest, resuming a partial file, then verify size and MD5."""
    import requests

    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and md5 and _md5(dest) == md5:
        return dest
    part = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(retries):
        have = part.stat().st_size if part.exists() else 0
        headers = {"User-Agent": UA}
        if have:
            headers["Range"] = f"bytes={have}-"
        try:
            with requests.get(_https(url), headers=headers, stream=True, timeout=(30, 300)) as r:
                if r.status_code == 404:
                    raise NotYetAvailable(url)
                if have and r.status_code == 200:      # server ignored Range: start over
                    have = 0
                    part.unlink(missing_ok=True)
                r.raise_for_status()
                with open(part, "ab" if have else "wb") as out:
                    for chunk in r.iter_content(CHUNK):
                        out.write(chunk)
            break
        except NotYetAvailable:
            raise
        except Exception as exc:  # noqa: BLE001 - network: resume from where it stopped
            if attempt == retries - 1:
                raise RuntimeError(f"download failed after {retries} attempts: {url}: {exc}") from exc
            time.sleep(min(60, 2 ** attempt * 3))
    if size and part.stat().st_size != size:
        raise ChecksumMismatch(f"{dest.name}: {part.stat().st_size} bytes, ENA lists {size}")
    if md5:
        got = _md5(part)
        if got != md5:
            part.unlink(missing_ok=True)
            raise ChecksumMismatch(f"{dest.name}: md5 {got}, ENA lists {md5}")
    part.rename(dest)
    return dest


def _md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        while chunk := fh.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def sample_reads(url: str, n: int = 200_000, max_bytes: int = 48 << 20) -> list[str]:
    """
    The first n read sequences of a gzipped FASTQ, streaming only its prefix.

    A gzip member decompresses from its start, so the first few MB of a
    multi-GB file are enough to see what the reads are. The download stops at
    max_bytes or n reads, whichever comes first.
    """
    import zlib

    import requests

    d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    buf, seqs, line_no, got = "", [], 0, 0
    with requests.get(_https(url), headers={"User-Agent": UA}, stream=True, timeout=(30, 120)) as r:
        if r.status_code == 404:
            raise NotYetAvailable(url)
        r.raise_for_status()
        for chunk in r.iter_content(1 << 20):
            got += len(chunk)
            buf += d.decompress(chunk).decode("ascii", errors="replace")
            *lines, buf = buf.split("\n")
            for line in lines:
                if line_no % 4 == 1:
                    seqs.append(line.strip())
                line_no += 1
            if len(seqs) >= n or got >= max_bytes:
                break
    return seqs[:n]


def probe_library(run: RunRecord, n: int = 200_000):
    """Library detection on a run's first reads, before anything is downloaded in full."""
    import gzip
    import tempfile

    from ..detect import detect_from_fastq

    url = next((u for u in run.fastq_urls if not re.search(r"_2\.f(ast)?q", u)), None)
    if url is None:
        raise NotYetAvailable(f"{run.run}: no read-1 FASTQ")
    seqs = sample_reads(url, n=n)
    with tempfile.NamedTemporaryFile(suffix=".fastq.gz", delete=False) as tmp:
        path = Path(tmp.name)
    with gzip.open(path, "wt") as fh:
        for i, s in enumerate(seqs):
            fh.write(f"@r{i}\n{s}\n+\n{'I' * len(s)}\n")
    try:
        return detect_from_fastq(path)
    finally:
        path.unlink(missing_ok=True)


def fetch_run(run: RunRecord, workdir: Path, with_mates: bool = False) -> list[Path]:
    """Download a run's FASTQ. Returns the file(s) to count first (read 1), then mates."""
    if not run.fastq_urls:
        raise NotYetAvailable(f"{run.run}: ENA lists no FASTQ")
    files = list(zip(run.fastq_urls, run.fastq_md5 or [None] * len(run.fastq_urls),
                     run.fastq_bytes or [None] * len(run.fastq_urls)))
    # _1 first; a lone file (single-end) is read 1; "_2" only with mates.
    files.sort(key=lambda f: (0 if re.search(r"_1\.f(ast)?q", f[0]) else 1 if not re.search(r"_2\.f(ast)?q", f[0]) else 2))
    if not with_mates:
        read1 = [f for f in files if not re.search(r"_2\.f(ast)?q", f[0])]
        files = read1[:1] if len(read1) > 1 and any(re.search(r"_1\.f(ast)?q", f[0]) for f in read1) else read1
    out = []
    for url, md5, size in files:
        name = url.rsplit("/", 1)[-1]
        out.append(download(url, workdir / run.run / name, md5, int(size) if size else None))
    return out


def fastqc(paths: list[Path], outdir: Path, threads: int = 4) -> list[tuple[Path, FastqcReport]]:
    """Run FastQC and parse each report. Missing FastQC is an error, never a skip."""
    exe = shutil.which("fastqc")
    if exe is None:
        raise RuntimeError("fastqc is not on PATH; the ingest image installs it from bioconda")
    outdir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run([exe, "--quiet", "--extract", "-t", str(threads), "-o", str(outdir), *map(str, paths)],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"fastqc failed: {proc.stderr[-2000:]}")
    reports = []
    for p in paths:
        stem = re.sub(r"\.(fastq|fq)(\.gz)?$", "", p.name)
        folder = outdir / f"{stem}_fastqc"
        if not folder.exists():
            z = outdir / f"{stem}_fastqc.zip"
            with zipfile.ZipFile(z) as zf:
                zf.extractall(outdir)
        reports.append((p, parse_fastqc(folder, run=p.parent.name, file=p.name)))
    return reports


def parse_fastqc(folder: Path, run: str, file: str) -> FastqcReport:
    rep = FastqcReport(run=run, file=file)
    summary = folder / "summary.txt"
    if summary.exists():
        for line in summary.read_text().splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                rep.modules[parts[1]] = parts[0]
    data = folder / "fastqc_data.txt"
    if data.exists():
        for line in data.read_text().splitlines():
            if line.startswith("Total Sequences\t"):
                rep.total_sequences = int(line.split("\t")[1])
            elif line.startswith("Sequence length\t"):
                rep.sequence_length = line.split("\t")[1]
            elif line.startswith("%GC\t"):
                rep.percent_gc = float(line.split("\t")[1])
            elif line.startswith(">>END_MODULE") and rep.percent_gc is not None:
                break
    return rep


def interpret(rep: FastqcReport) -> list[str]:
    """
    FastQC's defaults are tuned for genomic libraries. An amplicon screen fails
    "Per base sequence content", "Sequence Duplication Levels" and
    "Overrepresented sequences" by construction (every read starts with the same
    vector sequence and each guide is one repeated sequence), so those FAILs are
    expected and not reported as problems. Per-base quality and N content are.
    """
    expected = {"Per base sequence content", "Sequence Duplication Levels", "Overrepresented sequences",
                "Per sequence GC content", "Adapter Content", "Kmer Content"}
    return [f"FastQC {k}: {v}" for k, v in rep.modules.items() if v == "FAIL" and k not in expected]
