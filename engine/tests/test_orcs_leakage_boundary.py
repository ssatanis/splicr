"""Regression tests for the AssayBench <-> BioGRID ORCS leakage boundary.

If any of these fail, every AssayBench number produced by this repo is void.
"""
from __future__ import annotations

import json
import re

import pytest

from splicr import orcs_safe
from splicr.assaybench_io import load_split

ORCS_IDS = lambda name: [int(x) for x in re.findall(r"\d+", name)]  # noqa: E731


@pytest.fixture(scope="module")
def ab():
    return load_split(None, with_metadata=True)


def test_every_assaybench_record_resolves_to_orcs(ab):
    idx = set(orcs_safe.safe_ids("screen")) | set(orcs_safe.boundary()["excluded_orcs_ids_screen_level"])
    assert len(ab) == 1901
    for r in ab:
        ids = ORCS_IDS(r["dataset_name"])
        assert ids, f"{r['dataset_name']} encodes no ORCS screen id"
        assert set(ids) <= idx, f"{r['dataset_name']} -> {ids} not in the ORCS index"


def test_no_val_test_screen_is_in_any_safe_set(ab):
    bad = {i for r in ab if r["split"] in ("validation", "test") for i in ORCS_IDS(r["dataset_name"])}
    assert len(bad) == 359
    for policy in ("screen", "publication", "strict"):
        assert not (bad & set(orcs_safe.safe_ids(policy))), f"policy {policy} leaks"


def test_policies_are_nested():
    strict = orcs_safe.safe_ids("strict")
    pub = orcs_safe.safe_ids("publication")
    screen = orcs_safe.safe_ids("screen")
    assert strict <= pub <= screen
    assert len(screen) == 1593 and len(pub) == 1574 and len(strict) == 1560


def test_assert_safe_refuses_a_test_screen(ab):
    test_ids = sorted({i for r in ab if r["split"] == "test" for i in ORCS_IDS(r["dataset_name"])})
    orcs_safe.assert_safe(1)                       # ORCS 1 is an AssayBench train screen
    for sid in test_ids[:25]:
        with pytest.raises(orcs_safe.LeakageError):
            orcs_safe.assert_safe(sid)
    with pytest.raises(orcs_safe.LeakageError):
        orcs_safe.assert_safe(test_ids)            # a whole batch, not just one


def test_assert_safe_refuses_unknown_ids():
    with pytest.raises(orcs_safe.LeakageError):
        orcs_safe.assert_safe(999_999)


def test_parsed_cache_physically_excludes_val_test(ab):
    hits = orcs_safe.load_safe_hits()
    bad = {i for r in ab if r["split"] in ("validation", "test") for i in ORCS_IDS(r["dataset_name"])}
    assert not (bad & set(hits)), "the parsed cache contains a val/test screen"
    assert set(hits) <= set(orcs_safe.safe_ids("publication"))
    assert len(hits) == 1574


def test_parquet_cache_physically_excludes_val_test(ab):
    tb = orcs_safe.load_safe_long(columns=["screen_id"])
    ids = set(tb.column("screen_id").to_pylist())
    bad = {i for r in ab if r["split"] in ("validation", "test") for i in ORCS_IDS(r["dataset_name"])}
    assert not (bad & ids)


def test_no_orcs_screen_spans_train_and_val_test(ab):
    per = {}
    for r in ab:
        for i in ORCS_IDS(r["dataset_name"]):
            per.setdefault(i, set()).add(r["split"])
    spanning = {i: s for i, s in per.items() if "train" in s and (s & {"validation", "test"})}
    assert not spanning, f"screen(s) on both sides of the split: {spanning}"


def test_no_depmap_consortium_screen_in_val_test(ab):
    depmap_pmids = {"29083409", "30971826", "27260156", "28753430", "28753431"}
    leaked = [r["dataset_name"] for r in ab
              if r["source_id"] in depmap_pmids and r["split"] in ("validation", "test")]
    assert not leaked, f"DepMap-consortium screens in val/test: {leaked}"


def test_boundary_doc_is_self_consistent():
    b = orcs_safe.boundary()
    n = b["orcs"]["n_screens"]
    assert len(b["safe_orcs_ids"]) + len(b["excluded_orcs_ids"]) == n
    assert len(b["safe_orcs_ids_screen_level"]) + len(b["excluded_orcs_ids_screen_level"]) == n
    assert not (set(b["safe_orcs_ids"]) & set(b["excluded_orcs_ids"]))
    assert set(b["safe_orcs_ids_usable_full_library"]) <= set(b["safe_orcs_ids"])
    assert len(b["assaybench_to_orcs"]) == 1901
