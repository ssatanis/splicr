import sys, os, pickle, json; sys.path.insert(0,'.')
import numpy as np
from common import split_idx
from core import uni
from channels import ChannelBank
from extchan import build as ext_build
from retrieval import Retriever
from consensus import ORDER, LEAKY
import features
u=uni(); ext=ext_build(); donor=split_idx('pre2022')
N=json.load(open('cache/consensus_N.json'))['N']
CONS=[m for m in ORDER if m not in LEAKY][:N]
print('consensus models (CV-chosen N=%d):'%N, CONS)
R=Retriever(donor, idf_pow=1.0)
allq=np.concatenate([split_idx(s) for s in ['train','validation','test','latest']])
S=np.zeros((u.n, len(R.donor)), np.float32); S[allq]=R.sims(allq)
bank=ChannelBank(donor, ext=ext, retr=(R,S), cons_models=CONS)
for which in ['test','pre2022','validation','latest']:
    o=features.build(which, bank=bank, out=f'cache/feat_{which}.pkl')
    p=f'cache/pack_{which}.pkl'
    if os.path.exists(p): os.remove(p)
    print(which, len(o['recs']), len(o['names']), 'channels', flush=True)
