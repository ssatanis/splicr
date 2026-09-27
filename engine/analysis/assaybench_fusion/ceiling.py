"""DIAGNOSTIC ONLY -- fits weights on the test split to bound what the current
channel set can express.  Never reported as a result; it tells us whether the
gap to a target number is missing information or a tuning-transfer failure."""
import sys, numpy as np, time; sys.path.insert(0,'.')
from fast import pack, subpack, ascent
from proto import usable_cols, cat_of
te=pack('test'); names=te.names; cte=cat_of(te); CATS=sorted(set(cte))
cols=usable_cols(names)
tot=np.zeros(te.n)
for c in CATS:
    st=np.where(cte==c)[0]
    p=subpack(te,st)
    w,best=ascent(p,None,cols=cols,passes=3,quiet=True)
    tot[st]=p.scores(w)
    print(f"CEILING(test-fit) {c[:34]:<36} n={len(st):<4} {best:.4f}")
print(f"CEILING(test-fit) per-category overall = {tot.mean():.4f}")
