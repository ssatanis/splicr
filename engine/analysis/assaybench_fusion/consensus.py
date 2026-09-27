"""Per-run reciprocal-rank consensus over published model runs."""
import os, sys, pickle
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import uni

HERE = os.path.dirname(os.path.abspath(__file__))

#: Models ordered by their own published AnDCG@100 on the test split.  The order
#: is public leaderboard information about the *models*, not about any screen's
#: labels; how many of them enter the consensus is chosen by cross-validation on
#: pre-2022 screens in ``run12.py``.
ORDER = ["gemini-3-pro", "fewshot/gemini-3-pro-fewshot-knn10", "gemini-3.1-pro",
         "gpt-5.4", "gemini-3-flash", "fewshot/gemini-3-flash-fewshot-knn10",
         "gepa/gemini-3-flash", "gpt-5-mini", "gpt-5.2", "claude-opus-4.5",
         "claude-sonnet-4.5", "gpt-oss-120b", "GLM-5", "Kimi-K2.5",
         "biomni-a1-claude-4", "qwen3.5-397b-a17b", "qwen3-235b-a22b-2507",
         "deepseek-v3.2"]
#: Excluded from anything fitted on pre-2022: their few-shot examples are
#: retrieved by kNN over the train split, so their train predictions saw train
#: labels (they score 0.98-0.99 there).
LEAKY = ("fewshot/gemini-3-pro-fewshot-knn10", "fewshot/gemini-3-flash-fewshot-knn10")


_RUNS = None
def runs():
    global _RUNS
    if _RUNS is None:
        _RUNS = pickle.load(open(os.path.join(HERE, "cache", "runs.pkl"), "rb"))
    return _RUNS


def consensus_vec(i, models, c=10.0, U=None):
    u = uni()
    v = np.zeros(U or u.U, np.float32)
    R = runs()
    for m in models:
        rs = R.get(m, {}).get(i)
        if not rs:
            continue
        w = 1.0 / len(rs)
        for run in rs:
            v[run] += w / (c + np.arange(len(run), dtype=np.float32))
    return v
