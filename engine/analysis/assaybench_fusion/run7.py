import sys, numpy as np; sys.path.insert(0,'.')
from core import uni
from common import split_idx, score_vec
from knowledge import drug_vectors, reporter_vectors
from fast import pack
from proto import cat_of
u=uni(); test=split_idx('test'); te=pack('test'); cte=cat_of(te); names=te.names
ig=names.index('global_rate'); il=names.index('llm_gemini-3-pro')
prior={}; llm={}
for n,i in enumerate(test):
    a,b=te.off[n],te.off[n+1]
    prior[i]=(te.X[a:b,ig], te.X[a:b,il], te.recs[n]['pool'])
def eval_channel(vecfn, tag):
    fires=[]; base=[]; alone=[]; combo=[]; combo2=[]
    for n,i in enumerate(test):
        v=vecfn(u.meta[i])
        if v is None: continue
        lib=u.ulib[i]
        pr, lv, pool = prior[i]
        full_pr=np.zeros(len(lib)); full_pr[pool]=pr
        full_lv=np.zeros(len(lib)); full_lv[pool]=lv
        k=v[lib]
        fires.append(i)
        base.append(score_vec(i, full_pr))
        alone.append(score_vec(i, k+1e-6*full_pr))
        combo.append(score_vec(i, full_lv+1e-3*k+1e-6*full_pr))
        combo2.append(score_vec(i, full_lv+1e-1*k+1e-6*full_pr))
    if not fires: print(tag,'no fire'); return
    print(f"{tag:<26} n={len(fires):<4} prior={np.mean(base):.4f} alone={np.mean(alone):.4f} "
          f"llm+small={np.mean(combo):.4f} llm+big={np.mean(combo2):.4f}")
eval_channel(lambda m:(drug_vectors(m) or [None])[0],'drug target (seed)')
eval_channel(lambda m:(drug_vectors(m) or [None,None])[1],'drug target (expanded)')
eval_channel(lambda m:(reporter_vectors(m) or [None])[0],'reporter seed')
eval_channel(lambda m:(reporter_vectors(m) or [None,None])[1],'reporter expanded')
