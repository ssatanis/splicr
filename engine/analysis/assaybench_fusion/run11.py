"""Does the per-run self-consistency signal beat the shipped aggregate?"""
import sys, pickle, numpy as np; sys.path.insert(0,'.')
from core import uni
from common import split_idx, score_vec
from proto import cat_of
from fast import pack
u=uni(); runs=pickle.load(open('cache/runs.pkl','rb'))
test=split_idx('test'); te=pack('test'); cte=cat_of(te); CATS=sorted(set(cte)); names=te.names
ig=names.index('global_rate')
prior={}
for n,i in enumerate(test):
    a,b=te.off[n],te.off[n+1]
    v=np.zeros(len(u.ulib[i])); v[te.recs[n]['pool']]=te.X[a:b,ig]; prior[i]=v
MULTI=[m for m,p in runs.items() if not m.startswith('baseline') and 'Oracle' not in m
       and 'Embedding' not in m and np.mean([len(v) for v in p.values()] or [0])>1]
SINGLE=["gemini-3-pro","gpt-5.4","gemini-3.1-pro","gemini-3-flash","gpt-5-mini","gpt-5.2",
        "claude-opus-4.5","claude-sonnet-4.5","gepa/gemini-3-flash","biomni-a1-claude-4"]
print('multi-run models:',len(MULTI))
def rrf(models, c=10.0, per_run=True, cap=None):
    out={}
    for n,i in enumerate(test):
        lib=u.ulib[i]; v=np.zeros(u.U,np.float32)
        for m in models:
            rs=runs.get(m,{}).get(i)
            if not rs: continue
            use=rs if per_run else rs[:1]
            for run in use:
                r=run[:cap] if cap else run
                v[r]+=1.0/(c+np.arange(len(r)))
            if per_run: v_scale=1.0
        out[i]=v[lib]
    return out
def ev(tag,sc):
    s=np.array([score_vec(i, sc[i]+1e-9*prior[i]) for i in test])
    print(f"{tag:<46} {s.mean():.4f}  "+' '.join(f"{c[:10]}={s[cte==c].mean():.3f}" for c in CATS)); return s
ALL=sorted(set(MULTI)|set(SINGLE))
ev('shipped-aggregate RRF, all models', rrf(ALL, per_run=False))
ev('per-run RRF, all models (c=10)', rrf(ALL, per_run=True))
for c in [3,5,20,60]:
    ev(f'per-run RRF, all models (c={c})', rrf(ALL, per_run=True, c=c))
TOP=["gemini-3-pro","gpt-5.4","gemini-3.1-pro","gemini-3-flash"]
ev('per-run RRF, 4 strongest', rrf(TOP, per_run=True))
ev('per-run RRF, multi-run models only', rrf(MULTI, per_run=True))
