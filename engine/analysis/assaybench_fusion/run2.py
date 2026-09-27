import sys, os, pickle, numpy as np, time; sys.path.insert(0,'.')
from tune import load, cats, ascent
from features import score_all
from common import base, paired
tr=load('pre2022'); te=load('test'); names=tr['names']
ctr=cats(tr['recs']); cte=cats(te['recs'])
CATS=sorted(set(ctr)|set(cte))
def report(tag,per_cat_w=None,w=None):
    if w is not None:
        a=score_all(te['recs'],w); b=score_all(tr['recs'],w)
    else:
        a=np.zeros(len(te['recs'])); b=np.zeros(len(tr['recs']))
        for c in CATS:
            wc=per_cat_w.get(c, per_cat_w['__default__'])
            mt=np.where(cte==c)[0]; mr=np.where(ctr==c)[0]
            for j in mt: a[j]=score_all([te['recs'][j]],wc)[0]
            for j in mr: b[j]=score_all([tr['recs'][j]],wc)[0]
    print(f"{tag:<40} LOPO={b.mean():.4f}  TEST={a.mean():.4f}")
    for c in CATS:
        m=cte==c
        print(f"    {c[:38]:<40} n={m.sum():<4} {a[m].mean():.4f}")
    return a,b
i_g=names.index('global_rate')
# global tuning with all channels
t0=time.time()
w,best=ascent(tr['recs'],names,w0=None,passes=3)
print('global ascent %.0fs LOPO=%.4f'%(time.time()-t0,best))
for n,v in sorted(zip(names,w),key=lambda x:-abs(x[1]))[:25]:
    if v: print(f'    {n:<44}{v:+.2f}')
a,b=report('global-tuned (all channels)',w=w)
np.save('cache/w_global.npy',w)
