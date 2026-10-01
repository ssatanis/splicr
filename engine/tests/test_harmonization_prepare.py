"""Preparation logic for the database harmonization gate."""

from types import SimpleNamespace

from splicr.harmonization_prepare import decide


class Resolver:
    def __init__(self):
        self.calls = []

    def resolve(self, value):
        self.calls.append(value)
        if value == "ERBB2":
            return SimpleNamespace(ok=True, id="ENSG00000141736", label="ERBB2",
                                   status="resolved", reason=None, candidates=())
        return SimpleNamespace(ok=False, id=None, label=None, status="unresolved",
                               reason="no match", candidates=())


def test_decide_resolves_each_distinct_value_once_and_keeps_rejections():
    resolver = Resolver()
    out = decide(["ERBB2", "NTC_1", "ERBB2", None], resolver)
    assert resolver.calls == ["ERBB2", "NTC_1", ""]
    assert out["ERBB2"].canonical_id == "ENSG00000141736"
    assert out["ERBB2"].resolved
    assert not out["NTC_1"].resolved
    assert out["NTC_1"].reason == "no match"
    assert not out[""].resolved
