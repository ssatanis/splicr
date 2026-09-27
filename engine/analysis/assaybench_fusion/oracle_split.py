"""Is the oracle's donor a real neighbour, or the maximum of 1349 noisy draws?

Each screen's measured genes are split at random into halves A and B.  The donor
that scores best on half A is then scored on half B.  If donor choice carries
transferable signal, the A-chosen donor should also be near the top on B.  If the
oracle is mostly a selection maximum over 1349 candidate rankings, it will not be.
"""
import sys, numpy as np; sys.path.insert(0,'.')
from core import uni
from common import split_idx, K, DISC
from proto import cat_of
from fast import pack
u=uni(); donor=split_idx('pre2022'); test=split_idx('test')
tops=[]
for j in donor:
    lib=u.ulib[j]; rel=u.rel[j]
    n=min(K,len(rel)); o=np.argpartition(-rel,n-1)[:n]; o=o[np.argsort(-rel[o],kind='stable')]
    tops.append(lib[o])
ml=max(len(t) for t in tops)
TOP=np.zeros((len(donor),ml),np.int32); MASK=np.zeros((len(donor),ml),bool)
for j,t in enumerate(tops): TOP[j,:len(t)]=t; MASK[j,:len(t)]=True

def andcg_matrix(lib, rel):
    """AnDCG of every donor's top-100 against one (possibly partial) label set."""
    lookup=np.zeros(u.U,np.float32); inlib=np.zeros(u.U,bool)
    lookup[lib]=rel; inlib[lib]=True
    ideal=np.sort(np.maximum(rel,0))[::-1][:K]
    idcg=float(ideal @ DISC[:len(ideal)])
    if idcg<=0: return None
    m=min(K,len(rel)); mean=float(np.mean(rel))
    rand=float(np.full(m,mean) @ DISC[:m])/idcg
    den=1-rand
    vals=lookup[TOP]*MASK; keep=inlib[TOP]&MASK
    pos=np.cumsum(keep,axis=1)-1
    g=np.zeros(len(donor),np.float32)
    rr,cc=np.where(keep); p=pos[rr,cc]; ok=p<K
    np.add.at(g,rr[ok],vals[rr[ok],cc[ok]]*DISC[p[ok]])
    return np.maximum((g/idcg-rand)/den,0)

te=pack('test'); cte=cat_of(te)
REPS=int(__import__('os').environ.get('REPS','20'))
agg=[]
for rep in range(REPS):
  rng=np.random.default_rng(100+rep)
  rows=[]
  for n,i in enumerate(test):
    lib=u.ulib[i]; rel=u.rel[i]
    perm=rng.permutation(len(lib)); half=len(lib)//2
    A,B=perm[:half],perm[half:]
    ta=andcg_matrix(lib[A],rel[A]); tb=andcg_matrix(lib[B],rel[B])
    if ta is None or tb is None: continue
    j=int(np.argmax(ta))
    rows.append((tb[j], tb.max(), tb.mean(), float(np.percentile(tb,99))))
  agg.append(np.array(rows).mean(0))
agg=np.array(agg)
lab=["donor chosen on half A, scored on half B", "best donor on half B (oracle within B)",
     "mean over all donors on half B", "99th percentile donor on half B"]
print(f"screens scored per repeat: {len(rows)},  repeats: {REPS}")
for c,(l) in enumerate(lab):
    v=agg[:,c]
    print(f"  {l:<42} {v.mean():.4f}  [{np.percentile(v,2.5):.4f}, {np.percentile(v,97.5):.4f}]")
frac=agg[:,0]/agg[:,1]
print(f"  transferable fraction (A-pick / B-oracle) {frac.mean():.3f}  [{np.percentile(frac,2.5):.3f}, {np.percentile(frac,97.5):.3f}]")
