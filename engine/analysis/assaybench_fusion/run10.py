import sys, time, numpy as np, itertools, json; sys.path.insert(0,'.')
from fast import pack, subpack
from proto import cat_of, pub_of, grouped_folds
from modelsel import add_mix, BLEND, fit_blend
tr=pack('pre2022'); names=tr.names
ctr=cat_of(tr); pubs=pub_of(tr)
ORDER=sorted(set(ctr))
RANK=["gemini-3-pro","gpt-5.4","gemini-3.1-pro","gemini-3-flash","gpt-5-mini","gpt-5.2",
      "claude-opus-4.5","gepa/gemini-3-flash","claude-sonnet-4.5","gpt-oss-120b",
      "GLM-5","Kimi-K2.5","qwen3.5-397b-a17b","qwen3-235b-a22b-2507","deepseek-v3.2","biomni-a1-claude-4"]
GRID=[0.0,0.01,0.03,0.1,0.3,1.0,3.0]
folds=grouped_folds(pubs,5)
print('CV over consensus subset size (category-balanced, publication-grouped)')
res={}
for N in [1,2,3,4,6,8,12,16]:
    pk=add_mix(tr,RANK[:N]); cols=[pk.names.index(c) for c in BLEND]
    per=np.zeros(tr.n)
    for a,b in folds:
        w,_=fit_blend(pk,a,ctr[a],cols,GRID,passes=2)
        s=pk.scores(w,b); per[b]=s[b]
    cb=float(np.mean([per[ctr==c].mean() for c in ORDER]))
    res[N]=(cb,per.mean())
    print(f'  N={N:<3} cat-balanced CV={cb:.4f}  plain CV={per.mean():.4f}')
best=max(res,key=lambda k:res[k][0]); print('chosen N =',best)
json.dump({'N':best,'models':RANK[:best],'cv':res[best]},open('cache/sel_N.json','w'))
