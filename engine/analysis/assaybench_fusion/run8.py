import sys, time, numpy as np; sys.path.insert(0,'.')
from fast import pack, subpack
from proto import usable_cols, cat_of, pub_of, grouped_folds
from gbm import train, predict_scores
tr=pack('pre2022'); te=pack('test'); names=tr.names
cols=usable_cols(names)
cte=cat_of(te); CATS=sorted(set(cte))
pubs=pub_of(tr)
t0=time.time()
# publication-grouped CV inside pre-2022: the honest estimate of held-out quality
cv=[]
for k,(a,b) in enumerate(grouped_folds(pubs,5)):
    m=train(tr,a,cols,rounds=300)
    s=predict_scores(m,tr,cols,sel=b)
    cv.append((s[b].mean(),len(b)))
    print(f'  fold {k}: held-out {s[b].mean():.4f} (n={len(b)})',flush=True)
print(f'CV(pre2022, publication-grouped) = {sum(v*n for v,n in cv)/sum(n for _,n in cv):.4f}  [{time.time()-t0:.0f}s]')
m=train(tr,np.arange(tr.n),cols,rounds=300)
s=predict_scores(m,te,cols)
print(f'GBM LambdaRank TEST={s.mean():.4f}  '+' '.join(f'{c[:10]}={s[cte==c].mean():.3f}' for c in CATS))
imp=sorted(zip([names[j] for j in cols], m.feature_importance('gain')), key=lambda x:-x[1])[:20]
for n,v in imp: print(f'   {n:<42}{v:12.0f}')
np.save('cache/gbm_test.npy',s); m.save_model('cache/gbm.txt')
