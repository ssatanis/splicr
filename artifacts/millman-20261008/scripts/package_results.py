"""Export review evidence and create the portable attachment bundle."""
import csv
import hashlib
import json
import shutil
import time
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output'
DOWNLOADS=Path('/Users/sahaj/Downloads')
t=time.perf_counter()
genes=list(csv.DictReader((OUT/'all_gene_results.csv').open()))
top=genes[:190]
flagged=[r for r in top if 'single_guide' in r['flags'].split('; ')]
assert len(flagged)==41
def write(path,rows):
    with path.open('w') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
write(OUT/'top_1_percent_candidate_evidence.csv',top)
write(OUT/'flagged_top_1_percent_candidates.csv',flagged)
library=list(csv.DictReader((ROOT/'input/study_library.tsv').open(),delimiter='\t'))
counts={r['sgRNA']:r for r in csv.DictReader((ROOT/'input/counts.tsv').open(),delimiter='\t')}
seqs=defaultdict(list)
for r in library:seqs[r['sequence']].append(r)
ambiguities=[]
for seq,rows in seqs.items():
    labels=sorted({r['gene'] for r in rows if r['gene']})
    if len(labels)>1:
        for r in rows:ambiguities.append({'sequence':seq,'guide_id':r['guide_id'],'gene':r['gene'],
            'all_gene_labels_for_this_sequence':'; '.join(labels),'D0':counts[r['guide_id']]['D0'],
            'kidney':counts[r['guide_id']]['kidney']})
write(OUT/'shared_sequence_gene_annotation_review.csv',ambiguities)
keyraw=[{**r,'D0':counts[r['guide_id']]['D0'],'kidney':counts[r['guide_id']]['kidney']} for r in library if r['gene'] in ['SIX3','FCAMR','GSTM3','HSF2']]
write(OUT/'key_gene_raw_counts_and_sequences.csv',keyraw)

pdf=Path('/Users/sahaj/Documents/Projects/SplicR/output/pdf/SplicR-Millman-screen-analysis.pdf')
shutil.copy2(pdf,DOWNLOADS/pdf.name)
shutil.copy2(ROOT/'reply-draft.txt',DOWNLOADS/'SplicR-Millman-reply-draft.txt')
files=[(pdf,'SplicR-Millman-screen-analysis.pdf'),(ROOT/'README.md','README.md')]
for dirname in ['input','scripts']:
    files.extend((p,str(p.relative_to(ROOT))) for p in sorted((ROOT/dirname).rglob('*')) if p.is_file())
for name in ['szag012_supplementary_data.zip','Source_Data.xlsx','Supplementary_Tables.xlsx','Supplemental Figure.pdf']:
    p=ROOT/'source'/name;files.append((p,str(p.relative_to(ROOT))))
files.extend((p,str(p.relative_to(ROOT))) for p in sorted(OUT.glob('*')) if p.is_file() and p.name!='delivery.json' and p.suffix in {'.json','.csv','.log'})
for dirname in ['splicr','standalone_mageck','control_normalization']:
    files.extend((p,str(p.relative_to(ROOT))) for p in sorted((OUT/dirname).rglob('*')) if p.is_file() and p.suffix in {'.json','.txt','.log'})
manifest={'study_doi':'10.1093/stcltm/szag012','source':'Publisher supplementary data archive',
          'files':[{'path':name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p,name in files]}
dest=DOWNLOADS/'SplicR-Millman-full-results.zip'
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p,name in files:z.write(p,'SplicR-Millman-analysis/'+name)
    z.writestr('SplicR-Millman-analysis/manifest.json',json.dumps(manifest,indent=2)+'\n')
with zipfile.ZipFile(dest) as z:
    assert z.testzip() is None
    for entry in manifest['files']:
        assert hashlib.sha256(z.read('SplicR-Millman-analysis/'+entry['path'])).hexdigest()==entry['sha256']
email_files=[]
for p,name in files:
    # The publisher ZIP already contains all three original source files.
    # Guide statistics are preserved in all_guide_results.csv; avoid three
    # duplicate native guide tables. Canonical input counts are also retained.
    if name in ['source/Source_Data.xlsx','source/Supplementary_Tables.xlsx','source/Supplemental Figure.pdf']:
        continue
    if p.name.endswith('.sgrna_summary.txt') or (name.startswith('output/') and p.name=='counts.txt'):
        continue
    email_files.append((p,name))
email_manifest={**manifest,'files':[entry for entry in manifest['files'] if entry['path'] in {name for _,name in email_files}]}
email_zip=DOWNLOADS/'SplicR-Millman-results-to-attach.zip'
with zipfile.ZipFile(email_zip,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p,name in email_files:z.write(p,'SplicR-Millman-analysis/'+name)
    z.writestr('SplicR-Millman-analysis/manifest.json',json.dumps(email_manifest,indent=2)+'\n')
assert email_zip.stat().st_size<23_000_000
with zipfile.ZipFile(email_zip) as z:
    assert z.testzip() is None
    for entry in email_manifest['files']:
        assert hashlib.sha256(z.read('SplicR-Millman-analysis/'+entry['path'])).hexdigest()==entry['sha256']
(OUT/'delivery.json').write_text(json.dumps({'pdf':str(DOWNLOADS/pdf.name),'bundle':str(dest),
    'bundle_bytes':dest.stat().st_size,'bundle_sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),
    'file_count':len(manifest['files'])+1,'email_bundle':str(email_zip),'email_bundle_bytes':email_zip.stat().st_size,
    'package_and_verification_seconds':time.perf_counter()-t},indent=2)+'\n')
print(json.dumps(json.loads((OUT/'delivery.json').read_text()),indent=2))
