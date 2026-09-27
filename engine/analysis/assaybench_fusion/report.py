"""Turn results_fusion.json into the tables that go into RESULTS.md."""
import sys, os, json, numpy as np; sys.path.insert(0,'.')
from evaluate import paired, published_scores
from common import base, split_idx
HERE=os.path.dirname(os.path.abspath(__file__))
res=json.load(open(os.path.join(HERE,'results_fusion.json')))
PUB_ORDER=['Oracle kNN','LLM RRF Ensemble','gemini-3-pro','fewshot/gemini-3-pro-fewshot-knn10',
           'gemini-3.1-pro','gpt-5.4','gemini-3-flash','gepa/gemini-3-flash','gpt-5-mini',
           'baseline/coarse-phenotype-hit-freq','gpt-5.2','SFT + GRPO best (gpt-oss-120B)',
           'claude-opus-4.5','claude-sonnet-4.5','baseline/global-hit-freq','Embedding kNN',
           'baseline/random']
for split in ['test','validation','latest']:
    if split not in res: continue
    r=res[split]; cats=np.array(r['cats']); ours={k:np.array(v) for k,v in r['scores'].items()}
    ship=published_scores(split, False); dens=published_scores(split, True)
    print(f"\n## {split}  (n={len(cats)})\n")
    print("| system | shipped | densified | vs SplicR-Fusion (paired diff, 95% CI) |")
    print("|---|---|---|---|")
    base_v=ours['splicr_fusion']
    rows=[]
    for k,v in ours.items():
        rows.append((k, None, v.mean(), paired(v, base_v) if k!='splicr_fusion' else None))
    for m in PUB_ORDER:
        if m not in ship: continue
        s,names=ship[m]; d,_=dens[m]
        idx={int(n):i for i,n in enumerate(names)}
        al=np.array([base_v[i] for i,n in enumerate(r['names']) if int(n) in idx])
        bl=np.array([s[idx[int(n)]] for n in r['names'] if int(n) in idx])
        p=paired(bl, al)
        rows.append((m, s.mean(), d.mean(), p))
    for k,sh,dn,p in sorted(rows,key=lambda x:-(x[2] or 0)):
        pt = '' if p is None else f"{p[0]:+.4f} [{p[1]:+.4f}, {p[2]:+.4f}]"
        print(f"| {k} | {'' if sh is None else f'{sh:.4f}'} | {dn:.4f} | {pt} |")
    print("\nper category:")
    for c in sorted(set(cats)):
        m=cats==c
        line=f"  {c[:40]:<42} n={m.sum():<4}"
        for k,v in ours.items(): line+=f"  {k.split('_')[-1]}={v[m].mean():.4f}"
        print(line)
