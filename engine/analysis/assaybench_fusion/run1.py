import sys, os, pickle, numpy as np; sys.path.insert(0,'.')
from tune import load, cats, ascent
from features import score_all
from common import paired
tr=load('pre2022'); te=load('test')
names=tr['names']; assert names==te['names']
def show(tag,w):
    a=score_all(te['recs'],w); b=score_all(tr['recs'],w)
    print(f"{tag:<34} LOPO(pre2022)={b.mean():.4f}  TEST={a.mean():.4f}")
    return a
i_g=names.index('global_rate'); i_ph=names.index('cnt_cleaned_phenotype')
w=np.zeros(len(names)); w[i_g]=1.0; show('global_rate only',w)
w=np.zeros(len(names)); w[i_g]=1.0; w[i_ph]=1.0; show('global+pheno',w)
for m in ['gemini-3-pro','gpt-5.4']:
    w=np.zeros(len(names)); w[names.index('llm_'+m)]=1.0; show(f'{m} dense',w)
    w[i_g]=0.001; show(f'{m} dense + prior pad',w)
# equal-weight RRF over the strong LLMs, prior padding
strong=[n for n in names if n.startswith('llm_')]
w=np.zeros(len(names))
for n in strong: w[names.index(n)]=1.0
w[i_g]=0.001; show('all-LLM RRF + prior pad',w)
np.save('cache/w_init.npy',w)
