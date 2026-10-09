import sys, csv, io, json, time, subprocess, os
from pathlib import Path
import modal
ROOT=Path('/Users/sahaj/Documents/Projects/SplicR')
sys.path.insert(0,str(ROOT/'engine'))
if modal.is_local():
    from modal_app import image
else:
    image = None
app=modal.App('splicr-ferrarone-compute-audit')
@app.function(image=image,cpu=8,memory=4096,timeout=600)
def audit(counts):
    from threadpoolctl import threadpool_info
    import numpy
    info=threadpool_info()
    out=[]
    for blas,threads in [(None,1),('1',8)]:
        work=Path('/tmp/mle-audit')/str(threads);work.mkdir(parents=True)
        (work/'counts.tsv').write_text(counts)
        (work/'design.tsv').write_text('Samples\tbaseline\ttreatment\ntkov3_plasmid\t1\t0\nwt_3d_d21_a\t1\t1\nwt_3d_d21_b\t1\t1\n')
        env=dict(os.environ)
        if blas:env.update(OPENBLAS_NUM_THREADS=blas,OMP_NUM_THREADS=blas,MKL_NUM_THREADS=blas)
        cmd=['/opt/conda/bin/python','-c',"import random,runpy,sys,numpy as np;random.seed(0);np.random.seed(0);sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name='__main__')",'/opt/conda/bin/mageck','mle','-k','counts.tsv','-d','design.tsv','-n','mle','--permutation-round','10','--norm-method','median','--threads',str(threads)]
        t=time.monotonic();p=subprocess.run(cmd,cwd=work,env=env,capture_output=True,text=True)
        if p.returncode:raise RuntimeError(p.stderr[-2000:])
        rows=list(csv.DictReader((work/'mle.gene_summary.txt').open(),delimiter='\t'))
        out.append({'blas_threads':blas,'mageck_processes':threads,'seconds':time.monotonic()-t,'rows':rows})
    return {'initial_threadpools':info,'variants':out}
@app.local_entrypoint()
def main():
    source=ROOT/'artifacts/ferrarone-20261007/canonical/spheroid_crispr_screen_read_counts.txt'
    rows=list(csv.DictReader(source.open(),delimiter='\t'));bygene={}
    for row in rows:bygene.setdefault(row['Gene'],[]).append(row)
    selected=[g for g,r in bygene.items() if len(r)==4][:100]
    buf=io.StringIO();fields=['sgRNA','Gene','tkov3_plasmid','wt_3d_d21_a','wt_3d_d21_b'];w=csv.DictWriter(buf,fields,delimiter='\t');w.writeheader()
    for g in selected:
        for row in bygene[g]:w.writerow({k:row[k] for k in fields})
    result=audit.remote(buf.getvalue())
    target=ROOT/'artifacts/ferrarone-20261007/mle-compute-audit.json';target.write_text(json.dumps(result,indent=2))
    a,b=result['variants'];aa={r['Gene']:r for r in a['rows']};bb={r['Gene']:r for r in b['rows']}
    diffs={key:max(abs(float(aa[g][key])-float(bb[g][key])) for g in aa) for key in ['treatment|beta','treatment|fdr']}
    print(json.dumps({'genes':len(aa),'threadpools':result['initial_threadpools'],'timings':[{k:v for k,v in variant.items() if k!='rows'} for variant in result['variants']],'max_differences':diffs},indent=2))
