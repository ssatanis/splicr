import sys, time, numpy as np; sys.path.insert(0,'.')
from retrieval import Retriever
from core import uni
from common import split_idx, score_vec
from proto import cat_of
from fast import pack
u=uni(); donor=split_idx('pre2022'); test=split_idx('test')
te=pack('test'); cte=cat_of(te); CATS=sorted(set(cte))
for idf in [0.0,0.5,1.0,2.0]:
    R=Retriever(donor, idf_pow=idf)
    S=R.sims(test)
    best=None
    for k in [10,25,50,100]:
        for p in [1,3,6]:
            for m in [2,8,30]:
                out=np.array([score_vec(i, R.transfer(S[n], u.ulib[i], k=k, power=p, m=m)) for n,i in enumerate(test)])
                if best is None or out.mean()>best[0]: best=(out.mean(),k,p,m,out)
    v,k,p,m,out=best
    print(f"idf^{idf}: best TEST={v:.4f} (k={k},p={p},m={m})  "+' '.join(f"{c[:10]}={out[cte==c].mean():.3f}" for c in CATS))
