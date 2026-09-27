import sys, time, numpy as np; sys.path.insert(0,'.')
from pseudo import query_vectors, MODELS
from core import uni
from common import base, split_idx, score_vec, K, DISC
from proto import cat_of
from fast import pack
u=uni(); d=base()
Q=query_vectors()
donor=split_idx('pre2022'); test=split_idx('test')
D=u.Rel[donor].tocsr()
Dn=D.multiply(1.0/np.sqrt(np.maximum(np.asarray(D.multiply(D).sum(1)).ravel(),1e-9))[:,None]).tocsr()
Qt=Q[test].tocsr()
Qn=Qt.multiply(1.0/np.sqrt(np.maximum(np.asarray(Qt.multiply(Qt).sum(1)).ravel(),1e-9))[:,None]).tocsr()
S=(Qn @ Dn.T).toarray()   # test x donors pseudo-label similarity
print('sim matrix',S.shape, 'mean top1', S.max(1).mean().round(3))
te=pack('test'); cte=cat_of(te); CATS=sorted(set(cte))
# true transfer: donor's own relevance profile scored against query labels
def transfer_scores(i, wts, donors):
    lib=u.ulib[i]
    acc=np.zeros(u.U, np.float32)
    for j,w in zip(donors,wts):
        if w<=0: continue
        r=u.Rel[donor[j]]
        acc[r.indices]+=w*r.data
    return acc[lib]
# measured: does pseudo-label similarity find donors that actually transfer?
gp=np.zeros(len(test))
for kk,pw,tag in [(1,1,'top-1 donor'),(5,3,'top-5 p3'),(25,3,'top-25 p3'),(50,6,'top-50 p6')]:
    out=[]
    for n,i in enumerate(test):
        s=S[n]
        top=np.argpartition(-s,kk)[:kk] if kk<len(s) else np.arange(len(s))
        w=np.maximum(s[top],0)**pw
        v=transfer_scores(i,w,top)
        out.append(score_vec(i,v))
    out=np.array(out)
    print(f"pseudo-label kNN {tag:<12} TEST={out.mean():.4f}  "+' '.join(f"{c[:10]}={out[cte==c].mean():.3f}" for c in CATS))
np.save('cache/S_test.npy',S)
