import sys, os, time, pickle; sys.path.insert(0,'.')
import numpy as np
from common import base, split_idx, score_vec, paired
from core import uni
from channels import ChannelBank
u=uni(); d=base()
donor=split_idx('pre2022')
t0=time.time(); B=ChannelBank(donor); print('bank built in %.1fs'%(time.time()-t0))
test=split_idx('test')
t0=time.time(); ch=[B.for_screen(i) for i in test]; print('test channels %.1fs'%(time.time()-t0))
names=[k for k,v in ch[0].items() if isinstance(v,np.ndarray)]
print(len(names),'channels')
rows=[]
for nm in names:
    s=np.array([score_vec(i, c[nm]) for i,c in zip(test,ch)])
    rows.append((nm, s.mean(), (np.array([c[nm].any() for c in ch]).mean())))
for nm,v,cov in sorted(rows,key=lambda r:-r[1]): print(f'{nm:<42}{v:.4f}  cov={cov:.2f}')
pickle.dump(dict(test=test,ch=ch,names=names), open('cache/probe1.pkl','wb'))
