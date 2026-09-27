import sys; sys.path.insert(0,'.')
from common import *
d=base()
def pred_scores(model, i, dense=True):
    p=d['preds'][model].get(i)
    lib=d['lib'][i]
    s=np.zeros(len(lib))
    if p is None: return s
    rank={g:r for r,g in enumerate(p)}
    return np.array([ (1.0/(1+rank[g])) if g in rank else 0.0 for g in lib])
def shipped(model,i):
    """AnDCG of the list as shipped (unmeasured genes burn slots)."""
    p=d['preds'][model].get(i)
    if p is None: return np.nan
    lib=dict(zip(d['lib'][i], d['rel'][i]))
    hg=set()  # genes in lib; unmeasured-but-hgnc dropped after truncation
    rels=[]
    for g in p[:100]:
        if g in lib: rels.append(lib[g])
    return andcg_from_order(i,np.array(rels,dtype=np.float32))
if __name__=='__main__':
    models=[m for m in d['preds'] if not m.startswith('baseline') and 'Oracle' not in m]
    print(f"{'model':<42}{'train':>8}{'val':>8}{'test':>8}{'latest':>8} | dense: {'train':>7}{'val':>8}{'test':>8}")
    for m in models:
        row=[]
        for sp in ['train','validation','test','latest']:
            idx=[i for i in split_idx(sp) if i in d['preds'][m]]
            row.append(np.mean([shipped(m,i) for i in idx]) if idx else np.nan)
        dn=[]
        for sp in ['train','validation','test']:
            idx=[i for i in split_idx(sp) if i in d['preds'][m]]
            dn.append(np.mean([score_vec(i,pred_scores(m,i)) for i in idx]) if idx else np.nan)
        print(f"{m:<42}"+''.join(f"{x:8.4f}" for x in row)+' | '+''.join(f"{x:8.4f}" for x in dn))
