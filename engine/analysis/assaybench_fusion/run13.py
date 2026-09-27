"""Compare the linear blend, the LambdaRank model and their rank fusion,
all on the same publication-grouped folds and the same category-balanced
objective.  Choice is made on these numbers; test is scored once afterwards."""
import sys, os, json, numpy as np; sys.path.insert(0,'.')
from fast import pack, subpack
from proto import cat_of, pub_of, grouped_folds
from final_fit import fit, BLEND
from gbm import train, predict_scores
from common import K, DISC
tr=pack('pre2022'); cats=cat_of(tr); pubs=pub_of(tr); folds=grouped_folds(pubs,5)
cols=[tr.names.index(c) for c in BLEND]
gcols=[j for j,n in enumerate(tr.names) if not n.startswith('llm_fewshot/')]
ORDER=sorted(set(cats))
def cb(s): return float(np.mean([s[cats==c].mean() for c in ORDER]))
def rank_within(pk, v):
    """Per-screen descending rank of a score vector."""
    r=np.empty(len(v),np.float32)
    for j in range(pk.n):
        a,b=pk.off[j],pk.off[j+1]
        o=np.argsort(-v[a:b],kind='stable'); rr=np.empty(b-a,np.float32); rr[o]=np.arange(b-a)
        r[a:b]=rr
    return r
def score_from(pk, v, sel):
    out=np.zeros(pk.n)
    for j in sel:
        a,b=pk.off[j],pk.off[j+1]
        if pk.idcg[j]==0: continue
        sj=v[a:b]; rj=pk.rel[a:b]; m=b-a
        top=(np.argpartition(-sj,K-1)[:K] if m>K else np.arange(m))
        top=top[np.argsort(-sj[top],kind='stable')]
        obs=float(rj[top]@DISC[:len(top)])/pk.idcg[j]
        x=(obs-pk.rand[j])/pk.den[j]; out[j]=x if x>0 else 0.0
    return out
sb=np.zeros(tr.n); sg=np.zeros(tr.n); sf=np.zeros(tr.n)
for k,(a,b) in enumerate(folds):
    w,_=fit(tr,a,cols)
    vb=tr.X@w.astype(np.float32)
    sb[b]=score_from(tr,vb,b)[b]
    m=train(tr,a,gcols,rounds=300)
    vg=m.predict(tr.X[:,gcols]).astype(np.float32)
    sg[b]=score_from(tr,vg,b)[b]
    rb=rank_within(tr,vb); rg=rank_within(tr,vg)
    vf=1.0/(30.0+rb)+1.0/(30.0+rg)
    sf[b]=score_from(tr,vf,b)[b]
    print(f'  fold {k}: blend={sb[b].mean():.4f} gbm={sg[b].mean():.4f} fused={sf[b].mean():.4f}',flush=True)
print(f'CV cat-balanced: blend={cb(sb):.4f}  gbm={cb(sg):.4f}  rank-fused={cb(sf):.4f}')
print(f'CV plain       : blend={sb.mean():.4f}  gbm={sg.mean():.4f}  rank-fused={sf.mean():.4f}')
json.dump({'blend':cb(sb),'gbm':cb(sg),'fused':cb(sf)},open('cache/cv_models.json','w'))
