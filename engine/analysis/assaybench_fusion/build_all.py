import sys, os, pickle; sys.path.insert(0,'.')
import numpy as np
from common import split_idx
from core import uni
from channels import ChannelBank
from extchan import build as ext_build
import features
ext = ext_build()
donor = split_idx('pre2022')
bank = ChannelBank(donor, ext=ext)
for which in ['test','pre2022','validation','latest']:
    o = features.build(which, bank=bank, out=f'cache/feat_{which}.pkl')
    print(which, len(o['recs']), len(o['names']), 'channels')
pickle.dump(o['names'], open('cache/names.pkl','wb'))
