from pathlib import Path
import json,zipfile,csv,hashlib,datetime,shutil,xml.etree.ElementTree as ET
import pymupdf
base=Path('/Users/sahaj/Documents/Projects/SplicR/artifacts/ferrarone-20261007');out=base/'presentation';build=base/'deck-build';downloads=Path('/Users/sahaj/Downloads');dest=downloads/'SplicR-Varmus-lab';dest.mkdir(exist_ok=True)
sha=lambda x:hashlib.sha256(x).hexdigest()
proof=[]
for i in range(1,7):
 receipt=json.loads((base/f'comparison-{i}-receipt.json').read_text());data=json.loads((base/f'completed-mle-{receipt["id"]}.json').read_text());rows=list(csv.DictReader((base/f'comparison-{i}-genes.csv').open()));by={h['gene']:h for h in data['hits']}
 assert receipt['run_status']=='complete' and data['run']['status']=='complete'
 assert len(rows)==len(by)==len(data['hits'])==18049 and not data['sample_data'] and not data['rows']['truncated']
 for row in rows:
  h=by[row['gene_symbol']]
  for a,b in [('lfc','lfc'),('fdr','fdr'),('depleted_fdr','mageck_depletion_fdr'),('enriched_fdr','mageck_enrichment_fdr'),('mle_beta','mle_beta'),('mle_fdr','mle_fdr')]:assert float(row[a])==h[b],(i,row['gene_symbol'],a)
  assert 0<=h['mle_fdr']<=1
 proof.append({'comparison':receipt['name'],'status':'complete','genes':len(by),'csvMatchesLatestBrowserExport':True})
model=json.loads((build/'deck-content.json').read_text());assert len(model)==20
notes='\n\n'.join(f'## {i+1}. {m["title"]}\n\n{m["notes"]}' for i,m in enumerate(model));assert (out/'Speaker-notes.md').read_text()==notes
ppt=out/'SplicR-Varmus-lab-v10.pptx';ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
with zipfile.ZipFile(ppt) as z:
 for i,m in enumerate(model,1):
  actual=''.join(ET.fromstring(z.read(f'ppt/notesSlides/notesSlide{i}.xml')).itertext());assert m['notes'] in actual,(i,'notes diverged')
 html=(out/'SplicR-Varmus-lab.html').read_text();assert 'Publication-held-out Atlas context' not in html and 'full MLE comparison is still in progress' not in html
 assert 'all six full RRA+MLE runs' in html.lower() or 'all six full rra+mle runs' in html.lower()
pdf=pymupdf.open(out/'SplicR-Varmus-lab.pdf');assert len(pdf)==20
assert 'All six full RRA + MLE analyses are complete.' in pdf[8].get_text()
for v in ['MLE beta','MLE FDR','0.576','0.192','1.000','None passes MLE FDR 0.05']:assert v in pdf[11].get_text()
assert '172 flagged for review' in pdf[9].get_text() and '154 annotated pan-essential' in pdf[9].get_text()
assert 'Six complete RRA + MLE result packages' in pdf[19].get_text()
assert any(l.get('uri','').endswith('01a11702-77cc-72e2-9307-ab884d26facb') for l in pdf[19].get_links())
assert json.loads((build/'html-layout.json').read_text())['overflow']==[] and json.loads((build/'html-element-check.json').read_text())==[]
# The user-facing copies all come from this validated source.
files={
 'SplicR-Varmus-lab.pptx':ppt,
 'SplicR-Varmus-lab.pdf':out/'SplicR-Varmus-lab.pdf',
 'SplicR-Varmus-lab.html':out/'SplicR-Varmus-lab.html',
 'Speaker-notes.md':out/'Speaker-notes.md',
 'Meeting-prep.md':out/'Meeting-prep.md',
 'Explain-SplicR-and-the-demo.md':out/'Explain-SplicR-and-the-demo.md',
 'Cover-preview.png':out/'Cover-preview.png'}
for name,p in files.items():shutil.copyfile(p,dest/name)
# Replace only presentation outputs we authored. Keep earlier revisions privately.
for name in ['SplicR-Varmus-lab-v8.pptx','SplicR-Varmus-lab-v9.pptx']:
 if (out/name).exists():shutil.move(out/name,build/'superseded'/name)
start='''SplicR Varmus lab meeting kit — synchronized release v10\n\nRead presentation/Meeting-prep.md first for the simple biology, opening introduction, slide-by-slide wording and scientific questions.\n\nPresent presentation/SplicR-Varmus-lab.html offline. Click Present, use arrow keys, N for notes and Escape to exit. The PDF includes the critical result explanations and a clickable full-report link. Speaker notes are in the PowerPoint, HTML and separate Markdown file. The PDF does not contain the detailed notes.\n\nAll six full RRA+MLE analyses are complete. SplicR-Ferrarone-full-results.zip contains those full outputs. SplicR-Ferrarone-results.zip is the separate RRA validation cohort. Each comparison scores 18,049 genes. The chart's six-minute span is RRA only. The initial full RRA+MLE cohort took 5 hours 5 minutes, including retries.\n\nSelect Ferrarone 2024 · SplicR demo with your normal sign-in and open https://www.splicr.org/dashboard/screens/01a11702-77cc-72e2-9307-ab884d26facb for the full spheroid WT report. Review existing results and walk through configuration without clicking Initialize. No new job is required.\n\nSlide 10's flags are reasons to review, not automatic errors. 176 of 178 candidates are depleted, and 154 carry a DepMap pan-essential annotation. None of the three genes in slide 12 passes MLE FDR 0.05 in this analysis. Published beta-score nomination and experimental validation are separate evidence.\n\nThe paper's methods describe WT >0.5 / EV <0.5, while Figure 3D gives WT >1 / EV <1 for pathway input. Ask which rule generated that figure. The difference does not establish that the biology is wrong or that SplicR is more accurate. Exact publication reproduction remains open.\n\nUse this kit and the files in Downloads/SplicR-Varmus-lab together. Earlier downloaded or cached copies may have outdated slide text.\n'''
(dest/'START-HERE.txt').write_text(start.replace('presentation/',''))
# Refresh the existing full scientific bundle from the saved evidence, not from new computation.
fullzip=downloads/'SplicR-Ferrarone-full-results.zip'
with zipfile.ZipFile(fullzip) as z:old={n:z.read(n) for n in z.namelist()}
for name in list(old):
 if name.startswith('full-results/'):
  local=base/name.removeprefix('full-results/')
  if local.is_file():old[name]=local.read_bytes()
old['full-results/README.md']=(base/'README.md').read_bytes();old['full-results/candidate-flag-audit.json']=(base/'candidate-flag-audit.json').read_bytes()
temp=fullzip.with_suffix('.tmp')
with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as z:
 for name,data in old.items():z.writestr(name,data)
with zipfile.ZipFile(temp) as z:assert z.testzip() is None
temp.replace(fullzip)
manifest={'release':'v10','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'slides':20,'fullAnalyses':proof,'presentation':{n:{'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size} for n,p in files.items()},'newAnalysisJobsSubmitted':False,'scope':'Presentation, documentation, packaging and read-only production recheck. No new biological validation or independent full-genome MLE rerun.'}
(base/'release-sync-verification.json').write_text(json.dumps(manifest,indent=2)+'\n');(dest/'Release-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
kit=downloads/'SplicR-Varmus-lab-demo-kit.zip';temp=kit.with_suffix('.tmp')
with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as z:
 for name,p in files.items():z.write(p,'presentation/'+name)
 for p in sorted((out/'screenshots').glob('*')):
  if p.is_file():z.write(p,'presentation/screenshots/'+p.name)
 for name in ['SplicR-Ferrarone-demo.zip','SplicR-Ferrarone-results.zip','SplicR-Ferrarone-full-results.zip']:z.write(downloads/name,name)
 for name in ['README.md','source-manifest.json','mle-status-release.json','demo-workspace-access.json','mle-browser-check.json','mle-runtime.json','mle-completed-invariants.json','full-rra-validation-agreement.json','meeting-accuracy-recheck.json','candidate-flag-audit.json','release-sync-verification.json']:z.write(base/name,'verification/'+name)
 z.writestr('START-HERE.txt',start)
with zipfile.ZipFile(temp) as z:
 assert z.testzip() is None
 for name,p in files.items():assert z.read('presentation/'+name)==p.read_bytes()==(dest/name).read_bytes()
 for name in ['SplicR-Ferrarone-demo.zip','SplicR-Ferrarone-results.zip','SplicR-Ferrarone-full-results.zip']:assert z.read(name)==(downloads/name).read_bytes()
temp.replace(kit)
print(json.dumps({'release':'v10','checks':'passed','fullAnalyses':6,'geneRecordsChecked':6*18049,'slides':len(pdf),'kitBytes':kit.stat().st_size,'presentationCopiesIdentical':True,'kit':str(kit)},indent=2))
