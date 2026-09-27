"""Where the DCG actually comes from: the LLM head versus the padded tail."""
import sys, numpy as np; sys.path.insert(0,'.')
from fast import pack
from proto import cat_of
from common import DISC, K
te=pack('test'); names=te.names; cte=cat_of(te)
ig=names.index('global_rate'); il=names.index('llm_gemini-3-pro')
CATS=sorted(set(cte))
rows={}
for c in CATS:
    sel=np.where(cte==c)[0]
    head_g=np.zeros(K); head_n=np.zeros(K); nhead=[]
    tot=0.0
    for j in sel:
        a,b=te.off[j],te.off[j+1]
        lv=te.X[a:b,il]; pr=te.X[a:b,ig]; rel=te.rel[a:b]
        s=lv+1e-6*pr
        order=np.argsort(-s,kind='stable')[:K]
        nh=int((lv>0).sum()); nhead.append(min(nh,K))
        r=rel[order]
        if te.idcg[j]>0:
            head_g[:len(r)]+= r*DISC[:len(r)]/te.idcg[j]
            head_n[:len(r)]+=1
    prof=head_g/np.maximum(head_n,1)
    inlib=np.mean(nhead)
    print(f"{c[:34]:<36} n={len(sel):<4} mean in-library LLM genes={inlib:5.1f}")
    print(f"    nDCG share ranks  1-20:{prof[:20].sum():.4f}  21-62:{prof[20:62].sum():.4f}  63-100:{prof[62:].sum():.4f}")
