import sys, os, time, pickle, numpy as np; sys.path.insert(0,'.')
from fast import pack, subpack, ascent
from proto import usable_cols, cat_of, pub_of, cv_score
tr=pack('pre2022'); te=pack('test'); names=tr.names
ctr=cat_of(tr); cte=cat_of(te)
CATS=sorted(set(cte))
cols=usable_cols(names)
print('channels used:',len(cols),'of',len(names))
res={}
for c in CATS:
    sr=np.where(ctr==c)[0]; st=np.where(cte==c)[0]
    ptr=subpack(tr,sr)
    t0=time.time()
    w,best=ascent(ptr,None,cols=cols,passes=3,quiet=True)
    s=te.scores(w)
    print(f"{c[:36]:<38} n_tune={len(sr):<4} n_test={len(st):<4} fit={best:.4f} TEST_cat={s[st].mean():.4f}  ({time.time()-t0:.0f}s)")
    top=[(names[j],w[j]) for j in np.argsort(-np.abs(w)) if w[j]]
    print('     '+', '.join(f'{n}={v:+.2f}' for n,v in top[:8]))
    res[c]=w
np.save('cache/w_percat.npy', np.stack([res[c] for c in CATS])); pickle.dump(CATS,open('cache/cats.pkl','wb'))
a=np.zeros(te.n)
for c in CATS:
    st=np.where(cte==c)[0]; a[st]=te.scores(res[c],st)[st]
print(f"\nPER-CATEGORY FUSION  TEST={a.mean():.4f}")
