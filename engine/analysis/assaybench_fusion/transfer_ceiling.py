"""DIAGNOSTIC -- how far donor transfer could go with a *perfect* retriever.

Computes the true transfer matrix T[i, j] (donor j's own top-100 scored against
query i's labels) and then aggregates donors using T itself as the similarity.
That is an oracle and is never reported as a result; it answers one question:
is a better screen-similarity function worth building, or is multi-donor
transfer capped near the single-donor oracle anyway?
"""
import sys, numpy as np, time; sys.path.insert(0,'.')
from core import uni
from common import split_idx, score_vec, K, DISC
from proto import cat_of
from fast import pack
u=uni()
donor=split_idx('pre2022'); test=split_idx('test')
# donor top-100 by own relevance
tops=[]
for j in donor:
    lib=u.ulib[j]; rel=u.rel[j]
    n=min(K,len(rel))
    o=np.argpartition(-rel,n-1)[:n]; o=o[np.argsort(-rel[o],kind='stable')]
    tops.append(lib[o])
maxlen=max(len(t) for t in tops)
TOP=np.full((len(donor),maxlen),-1,np.int32); MASK=np.zeros((len(donor),maxlen),bool)
for j,t in enumerate(tops):
    TOP[j,:len(t)]=t; MASK[j,:len(t)]=True
te=pack('test'); cte=cat_of(te)
T=np.zeros((len(test),len(donor)),np.float32)
t0=time.time()
for n,i in enumerate(test):
    lookup=np.zeros(u.U,np.float32); inlib=np.zeros(u.U,bool)
    lookup[u.ulib[i]]=u.rel[i]; inlib[u.ulib[i]]=True
    idx=np.where(MASK,TOP,0)
    vals=lookup[idx]*MASK
    keep=inlib[idx]&MASK       # condensed: only in-library genes occupy a slot
    # densify per row: positions of kept entries
    pos=np.cumsum(keep,axis=1)-1
    g=np.zeros(len(donor),np.float32)
    rr,cc=np.where(keep)
    p=pos[rr,cc]
    ok=p<K
    np.add.at(g,rr[ok],vals[rr[ok],cc[ok]]*DISC[p[ok]])
    if te.idcg[n]>0:
        T[n]=np.maximum((g/te.idcg[n]-te.rand[n])/te.den[n],0)
print('T built %.0fs; oracle(max over donors, DENSIFIED)=%.4f'%(time.time()-t0,T.max(1).mean()))
np.save('cache/T_test.npy',T)
CATS=sorted(set(cte))
print('  per cat oracle: '+' '.join(f'{c[:10]}={T.max(1)[cte==c].mean():.3f}' for c in CATS))
# oracle-weighted multi-donor aggregation
prior=np.asarray(((u.H[donor].sum(0)+20*float(u.H[donor].sum())/float(u.M[donor].sum()))/(u.M[donor].sum(0)+20))).ravel().astype(np.float32)
D=u.Rel[donor].tocsr(); M=u.M[donor].tocsr()
from scipy import sparse
for kk,pw,mm in [(1,1,0),(5,4,2),(10,6,2),(25,8,4),(50,8,4)]:
    out=[]
    for n,i in enumerate(test):
        s=T[n]
        top=np.argpartition(-s,kk-1)[:kk] if kk<len(s) else np.arange(len(s))
        w=np.maximum(s[top],0)**pw
        if w.sum()<=0: out.append(0.0); continue
        num=np.asarray(sparse.csr_matrix(w.reshape(1,-1)).dot(D[top]).todense()).ravel()
        den=np.asarray(sparse.csr_matrix(w.reshape(1,-1)).dot(M[top]).todense()).ravel()
        sc=(num+mm*w.sum()/kk*prior)/(den+mm*w.sum()/kk)
        out.append(score_vec(i,sc[u.ulib[i]]))
    out=np.array(out)
    print(f'ORACLE-weighted transfer k={kk:<3} p={pw} m={mm}: TEST={out.mean():.4f}  '+' '.join(f'{c[:10]}={out[cte==c].mean():.3f}' for c in CATS))
