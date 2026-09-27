import sys, numpy as np, json; sys.path.insert(0,'.')
from core import uni
from common import split_idx, score_vec
from proto import cat_of, pub_of, grouped_folds
from fast import pack
from consensus import ORDER, LEAKY, consensus_vec
u=uni()
tr=pack('pre2022'); te=pack('test')
ctr=cat_of(tr); cte=cat_of(te); CATS=sorted(set(cte))
names=te.names; ig=names.index('global_rate')
def prior_map(pk, idx):
    out={}
    for n,i in enumerate(idx):
        a,b=pk.off[n],pk.off[n+1]
        v=np.zeros(len(u.ulib[i]),np.float32); v[pk.recs[n]['pool']]=pk.X[a:b,ig]; out[i]=v
    return out
ptr=prior_map(tr,tr.i); pte=prior_map(te,te.i)
CLEAN=[m for m in ORDER if m not in LEAKY]
print(f"{'N':<4}{'CV cat-balanced':>18}{'CV plain':>10}{'TEST':>10}   per-category test")
best=None
for N in range(1,len(CLEAN)+1):
    ms=CLEAN[:N]
    cv=np.array([score_vec(i, consensus_vec(i,ms)[u.ulib[i]]+1e-9*ptr[i]) for i in tr.i])
    t=np.array([score_vec(i, consensus_vec(i,ms)[u.ulib[i]]+1e-9*pte[i]) for i in te.i])
    cb=float(np.mean([cv[ctr==c].mean() for c in CATS if (ctr==c).any()]))
    if best is None or cb>best[0]: best=(cb,N)
    print(f"{N:<4}{cb:>18.4f}{cv.mean():>10.4f}{t.mean():>10.4f}   "+' '.join(f"{c[:8]}={t[cte==c].mean():.3f}" for c in CATS))
print('CV-chosen N =',best[1])
json.dump({'N':best[1],'models':CLEAN[:best[1]]},open('cache/consensus_N.json','w'))
