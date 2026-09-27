import sys, os, pickle; sys.path.insert(0,'.')
import numpy as np
from common import split_idx
from core import uni
from channels import ChannelBank
from extchan import build as ext_build
from retrieval import Retriever
import features
u=uni(); ext=ext_build(); donor=split_idx('pre2022')
R=Retriever(donor, idf_pow=1.0)
allq=np.concatenate([split_idx(s) for s in ['train','validation','test','latest']])
S=np.zeros((u.n, len(R.donor)), np.float32)
S[allq]=R.sims(allq)
bank=ChannelBank(donor, ext=ext, retr=(R,S))
for which in ['test','pre2022','validation','latest']:
    o=features.build(which, bank=bank, out=f'cache/feat_{which}.pkl')
    print(which, len(o['recs']), len(o['names']), 'channels', flush=True)
    p=f'cache/pack_{which}.pkl'
    if os.path.exists(p): os.remove(p)
pickle.dump(o['names'], open('cache/names.pkl','wb'))
