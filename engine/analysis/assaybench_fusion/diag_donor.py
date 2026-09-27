"""DIAGNOSTIC -- what does the best-transferring donor share with the query?"""
import sys, numpy as np, collections; sys.path.insert(0,'.')
from core import uni, entity_keys
from common import split_idx
from proto import cat_of
from fast import pack
u=uni(); donor=split_idx('pre2022'); test=split_idx('test')
T=np.load('cache/T_test.npy'); te=pack('test'); cte=cat_of(te)
K=[entity_keys(m) for m in u.meta]
S=np.load('cache/S_test.npy') if __import__('os').path.exists('cache/S_test.npy') else None
for cat in sorted(set(cte)):
    sel=np.where(cte==cat)[0]
    agree=collections.Counter(); n=0
    ranks=[]
    for n_,j in enumerate(sel):
        i=test[j]; t=T[j]
        best=int(np.argmax(t)); dj=donor[best]
        if t[best]<=0: continue
        n+=1
        for f in ('cleaned_phenotype','screen_type','direction','cell_line','cell_type',
                  'library_methodology','experimental_setup','compound','pathogen'):
            a,b=K[i][f],K[dj][f]
            if a and a==b: agree[f]+=1
        if S is not None:
            ranks.append(int((S[j]>S[j][best]).sum()))
    print(f"{cat[:34]:<36} n={n:<4} "+' '.join(f"{f[:9]}={agree[f]/max(n,1):.2f}" for f in
          ('cleaned_phenotype','direction','cell_line','library_methodology','experimental_setup','compound','pathogen')))
    if ranks: print(f"      rank of the best donor under our pseudo-label similarity: median={int(np.median(ranks))}, top-10 hit rate={np.mean(np.array(ranks)<10):.2f}, top-100={np.mean(np.array(ranks)<100):.2f}")
