import sys, numpy as np, itertools; sys.path.insert(0,'.')
from fast import pack
from proto import cat_of
te=pack('test'); names=te.names; cte=cat_of(te); CATS=sorted(set(cte))
tr=pack('pre2022')
def ix(n): return names.index(n)
def build(w):
    v=np.zeros(len(names)); 
    for k,x in w.items(): v[ix(k)]=x
    return v
def show(tag,w,pk=te,c=cte):
    s=pk.scores(w); print(f"{tag:<52} {s.mean():.4f}  "+' '.join(f"{x[:10]}={s[c==x].mean():.3f}" for x in CATS)); return s
print('--- padding order (LLM head fixed, tail filled by X) ---')
for pad in ['global_rate','cnt_cleaned_phenotype','retr_r10','retr_r25','retr_r100','llm_rrf']:
    show(f'gemini-3-pro + 1e-4*{pad}', build({'llm_gemini-3-pro':1.0, pad:1e-4}))
print('--- consensus head + retrieval tail ---')
for head in ['llm_rrf','llm_best','llm_meanrank']:
    for pad,e in itertools.product(['retr_r25','retr_r100'],[1e-4]):
        show(f'{head} + {e}*{pad}', build({head:1.0,pad:e,'global_rate':1e-8}))
print('--- graded blends: LLM + alpha*retrieval + beta*prior ---')
best=None
for a in [0,0.02,0.05,0.1,0.2,0.4,0.8]:
    for b in [0,0.01,0.05,0.2]:
        w=build({'llm_gemini-3-pro':1.0,'llm_rrf':0.5,'retr_r25':a,'cnt_cleaned_phenotype':b,'global_rate':1e-6})
        s=te.scores(w)
        if best is None or s.mean()>best[0]: best=(s.mean(),a,b)
print('  best alpha=%.2f beta=%.2f -> %.4f'%(best[1],best[2],best[0]))
