"""Exact sequence/PAM verified GRCh38 targeting, including libraries without hints.

Bowtie is a locator, not an efficacy/off-target predictor. Capped alignment lists
are flagged and never interpreted as unique. Cache keys include source bytes and
command settings; unknown coordinates never receive a guessed convention.
"""
from __future__ import annotations
from collections import defaultdict
from dataclasses import replace
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from .config import REFERENCE_DIR, TOOLS_DIR
from .references import Library
from .validate.genome import Genome, place_guide, revcomp


@lru_cache(maxsize=32)
def _hash(path: str, size: int, modified: int, changed: int, inode: int) -> str:
    with open(path, 'rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def file_identity(path: Path) -> str | None:
    if not path.exists(): return None
    info = path.stat()
    return _hash(str(path), info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_ino)


def _bowtie() -> str | None:
    for path in [Path(os.environ.get('SPLICR_TOOL_BIN','/opt/conda/bin'))/'bowtie', TOOLS_DIR/'env/bin/bowtie']:
        if path.exists(): return str(path)
    return shutil.which('bowtie')


def _align(genome: Genome, guides: list, source_identity: dict) -> tuple[dict, str | None]:
    program = _bowtie(); index = genome.path.with_suffix('')
    index_files = list(genome.path.parent.glob(index.name+'*.ebwt')) + list(genome.path.parent.glob(index.name+'*.ebwtl'))
    if not program or len(index_files) < 6:
        return {}, 'Bowtie or its matching genome index is unavailable; only verified nominated loci can be displayed'
    sequences = sorted({g.sequence.upper() for g in guides if not g.is_control and len(g.sequence) == 20 and not set(g.sequence.upper())-set('ACGT')})
    if not sequences: return {}, None
    command_settings = ['-v','0','-k','100','--best','--strata','--seed','0','-p','2','-f']
    identity = {**source_identity, 'sequences_sha256': hashlib.sha256('\n'.join(sequences).encode()).hexdigest(),
                'bowtie_sha256': file_identity(Path(program)),
                'align_binary_sha256': {p.name:file_identity(p) for p in Path(program).parent.glob('bowtie-align-*')}, 'index_sha256': {p.name:file_identity(p) for p in sorted(index_files)},
                'command_settings': command_settings}
    key = hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
    cache = REFERENCE_DIR/'derived'/'guide-mapping'/f'{key}.json'
    if cache.exists():
        try:
            saved = json.loads(cache.read_text())
            if saved.get('identity') == identity:
                return saved['mappings'], None
        except (OSError,ValueError,KeyError):
            pass  # Incomplete/corrupt caches are rebuilt, never treated as evidence.
    mappings, occurrences = {}, defaultdict(list)
    with tempfile.TemporaryDirectory(prefix='splicr-guides-') as tmp:
        source, output = Path(tmp)/'guides.fa', Path(tmp)/'alignments.tsv'
        source.write_text(''.join(f'>{i}\n{seq}\n' for i,seq in enumerate(sequences)))
        try:
            subprocess.run([program,*command_settings,str(index),str(source),str(output)],check=True,capture_output=True,text=True,timeout=1800)
        except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as exc:
            return {}, f'Exact genome alignment did not complete: {type(exc).__name__}'
        for text in output.open():
            fields = text.rstrip('\n').split('\t')
            if len(fields) >= 4:
                occurrences[int(fields[0])].append((fields[1],fields[2],int(fields[3])))
        for i,seq in enumerate(sequences):
            alignments = occurrences[i]; sites = set()
            for strand,chrom,start in alignments:
                # Native Bowtie offset is the leftmost zero-based reference base.
                observed = genome.fetch(chrom,start,start+20)
                if (observed if strand=='+' else revcomp(observed)) != seq:
                    continue  # index/FASTA disagreement is not a valid placement
                pam = genome.fetch(chrom,start+20,start+23) if strand=='+' else revcomp(genome.fetch(chrom,start-3,start))
                if len(pam)==3 and pam[1:]=='GG':
                    sites.add((chrom,start+17 if strand=='+' else start+3,strand,pam))
            mappings[seq] = {'sites':[list(site) for site in sorted(sites)], 'n_exact_alignments':len(alignments),
                'capped':len(alignments)>=100, 'genome_sha256':identity.get('genome_sha256'), 'alignment_identity_sha256':key,
                'scope':'Exact 20nt matches with NGG PAM in this indexed reference; no mismatch/bulge or sample-variant specificity claim'}
    try:
        cache.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile('w',dir=cache.parent,delete=False) as handle:
            json.dump({'identity':identity,'mappings':mappings},handle,allow_nan=False)
            temporary=Path(handle.name)
        temporary.replace(cache)
    except OSError:
        pass  # A read-only reference volume changes caching, not the measurements.
    return mappings, None


def verified_library_coordinates(library):
    try: genome=Genome()
    except FileNotFoundError:
        return replace(library,guides=[replace(g,chrom=None,cut_pos=None,strand=None) for g in library.guides],_by_sequence={}), {
            g.guide_id:{'status':'unresolved','reason':'GRCh38 FASTA and index unavailable; raw library coordinates were not assumed correct'} for g in library.guides}
    verified, notes = [], {}
    try:
        identity={'genome_sha256':file_identity(genome.path),'fai_sha256':file_identity(genome.path.with_suffix('.fa.fai'))}
        alignments, alignment_reason = _align(genome,library.guides,identity)
        for guide in library.guides:
            if guide.is_control:
                verified.append(replace(guide,chrom=None,cut_pos=None,strand=None)); continue
            result=alignments.get(guide.sequence.upper()); chosen=None
            if result and not result['capped'] and len(result['sites'])==1:
                chosen=result['sites'][0]
            elif guide.chrom and guide.cut_pos is not None:
                site=place_guide(genome,guide.chrom,guide.cut_pos,guide.sequence,guide.guide_id,strand_hint=guide.strand)
                if site.ok: chosen=[site.chrom,site.cut_pos,site.strand,site.pam]
            if chosen:
                chrom,cut,strand,pam=chosen
                verified.append(replace(guide,chrom=chrom if chrom.startswith('chr') else f'chr{chrom}',cut_pos=cut,strand=strand))
                notes[guide.guide_id]={'status':'sequence_and_pam_verified','assembly':'GRCh38','pam':pam,
                    'resolution':'unique_exact_pam_locus' if result and not result['capped'] and len(result['sites'])==1 else 'library_nominated_locus',
                    'alignment':result,'alignment_unavailable_reason':alignment_reason,**identity}
            else:
                verified.append(replace(guide,chrom=None,cut_pos=None,strand=None))
                reason=alignment_reason or ('Alignment reporting cap reached; uniqueness unknown' if result and result['capped'] else
                    'Multiple exact NGG loci without a verified nominated target' if result and len(result['sites'])>1 else 'No exact NGG target resolved in this reference')
                notes[guide.guide_id]={'status':'unresolved','reason':reason,'alignment':result,**identity}
    finally: genome.close()
    return replace(library,guides=verified,_by_sequence={}),notes
