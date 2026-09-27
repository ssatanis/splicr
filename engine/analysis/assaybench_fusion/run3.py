import sys, os, time, pickle, numpy as np; sys.path.insert(0,'.')
from fast import pack, ascent
from common import base
tr=pack('pre2022'); te=pack('test'); names=tr.names
d=base()
ctr=np.array([d['meta'][i]['cleaned_phenotype'] for i in tr.i])
cte=np.array([d['meta'][i]['cleaned_phenotype'] for i in te.i])
CATS=sorted(set(cte))
def per_cat_report(tag, wmap):
    a=np.zeros(te.n); b=np.zeros(tr.n)
    for c in set(list(ctr)+list(cte)):
        w=wmap.get(c, wmap['__default__'])
        st=np.where(cte==c)[0]; sr=np.where(ctr==c)[0]
        if len(st): a[st]=te.scores(w, st)[st]
        if len(sr): b[sr]=tr.scores(w, sr)[sr]
    print(f"{tag:<34} LOPO={b.mean():.4f} TEST={a.mean():.4f}")
    for c in CATS:
        m=cte==c; print(f"    {c[:36]:<38} n={m.sum():<4} {a[m].mean():.4f}")
    return a,b
i_g=names.index('global_rate')
# quick reference configs, per category
for tag, chans in [('gemini+prior',['llm_gemini-3-pro']), ('rrf+prior',['llm_rrf'])]:
    w=np.zeros(len(names)); w[i_g]=0.001
    for c in chans: w[names.index(c)]=1.0
    a=te.scores(w); print(f"{tag:<34} TEST={a.mean():.4f} "+' '.join(f"{c[:12]}={a[cte==c].mean():.3f}" for c in CATS))
t0=time.time()
w,best=ascent(tr, None, passes=2)
print('global ascent %.0fs LOPO=%.4f TEST=%.4f'%(time.time()-t0,best,te.scores(w).mean()))
np.save('cache/w_global.npy',w)
for n,v in sorted(zip(names,w),key=lambda x:-abs(x[1])):
    if v: print(f'    {n:<44}{v:+.2f}')
a=te.scores(w); print('  per cat: '+' '.join(f"{c[:12]}={a[cte==c].mean():.3f}" for c in CATS))
