"""Integration coverage for the escape and Cas12a HTTP boundary."""

from fastapi.testclient import TestClient
import pytest

from splicr import multiplex as mx
from splicr.api import create_app, security
from splicr.api import escape as api
from splicr.escape import analysis as an
from splicr.escape import evidence as ev
from splicr.escape import trigger as tg


def _caller(*scopes: str) -> security.Caller:
    return security.Caller(
        key_id="key", key_name="test", org_id="org", org_slug="lab",
        scopes=scopes, _key_hash="x" * 64,
    )


@pytest.fixture
def client():
    application = create_app()
    application.dependency_overrides[security.authenticate] = lambda: _caller(
        security.HITS_READ)
    return TestClient(application, raise_server_exceptions=False)


def _request(**overrides):
    body = {
        "screen_label": "A375 RSL3",
        "model_id": "ACH-000219",
        "qc_verdict": "pass",
        "fitness_contrast": True,
        "nnmd": -1.82,
        "reference_essential_effects": [-1.9] * 60,
        "essential_set": "CEGv2",
        "observations": [{
            "gene": "ENSG00000117713",
            "symbol": "ARID1A",
            "lfc": -0.08,
            "n_guides": 4,
            "expression_log1p_tpm": 4.7,
            "expectation_source": "DepMap",
            "expected_to_deplete": True,
        }],
    }
    body.update(overrides)
    return body


def _analysis_result() -> an.ScreenResult:
    assessment = tg.Assessment(
        gene="ENSG00000117713", symbol="ARID1A",
        verdict="unexpectedly_weak", reason="weaker than the screen reference",
        percentile_among_essentials=0.98, n_reference_essentials=60,
        weak_threshold_lfc=-1.9, observed_lfc=-0.08,
        provenance={"screen": "A375 RSL3"},
    )
    channels = (
        ev.Channel(
            name="paralogy", availability="available", supports=True,
            statement="two sources agree", n_units=2, unit="sources",
            source="Ensembl, HGNC", limitation="not causal",
        ),
        ev.Channel(
            name="conditional_dependency", availability="available", supports=True,
            statement="selectively essential when ARID1A is lost", value=-0.42,
            interval=(-0.61, -0.24), n_units=84, unit="cell lines",
            source="DepMap", limitation="observational",
        ),
    )
    hypothesis = ev.Hypothesis(
        target="ENSG00000117713", candidate="ENSG00000189079",
        target_symbol="ARID1A", candidate_symbol="ARID1B",
        model="ACH-000219", channels=channels,
        provenance={"paralog_build": "Ensembl 116"},
    )
    target = an.TargetResult(assessment=assessment, hypotheses=(hypothesis,))
    return an.ScreenResult(
        screen="A375 RSL3", eligible=True, assessments=(assessment,),
        targets=(target,), provenance={"essential_set": "CEGv2"},
    )


def test_escape_route_serializes_the_ranked_hypothesis(client, monkeypatch):
    monkeypatch.setattr(api.an, "analyse", lambda *args, **kwargs: _analysis_result())

    response = client.post("/v1/escape/analyse", json=_request())

    assert response.status_code == 200
    body = response.json()
    assert body["eligible"] is True
    assert body["flagged"] == 1
    assert body["targets"][0]["leading_candidate"] == "ARID1B"
    hypothesis = body["targets"][0]["hypotheses"][0]
    assert hypothesis["strength"] == "moderate"
    assert hypothesis["supporting"] == ["paralogy", "conditional_dependency"]
    assert hypothesis["channels"][1]["interval"] == [-0.61, -0.24]
    assert "hypothesis" in hypothesis["statement"].lower()


def test_escape_route_preserves_an_ineligible_screen_reason(client, monkeypatch):
    result = an.ScreenResult(
        screen="failed screen", eligible=False,
        reason="this screen's QC failed", provenance={"essential_set": "CEGv2"},
    )
    monkeypatch.setattr(api.an, "analyse", lambda *args, **kwargs: result)

    response = client.post("/v1/escape/analyse", json=_request(qc_verdict="fail"))

    assert response.status_code == 200
    assert response.json()["reason"] == "this screen's QC failed"
    assert response.json()["targets"] == []


def test_escape_route_rejects_unknown_fields(client):
    response = client.post(
        "/v1/escape/analyse", json={**_request(), "confidence": 0.99})
    assert response.status_code == 422
    assert response.json()["error"] == "invalid_request"


def test_escape_route_rejects_unknown_qc_verdict(client):
    response = client.post(
        "/v1/escape/analyse", json=_request(qc_verdict="probably fine"))
    assert response.status_code == 422


def test_escape_route_requires_a_connect_key():
    client = TestClient(create_app(), raise_server_exceptions=False)
    response = client.post("/v1/escape/analyse", json=_request())
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_escape_route_requires_hits_read_scope():
    application = create_app()
    application.dependency_overrides[security.authenticate] = lambda: _caller()
    response = TestClient(application).post("/v1/escape/analyse", json=_request())
    assert response.status_code == 403


def test_multiplex_route_serializes_construct_and_measured_specificity(client, monkeypatch):
    spacer = mx.Spacer(
        gene="ARID1A", sequence="ACGTACGTACGTACGTACGTACG", chrom="1",
        start=27_000_000, strand="+", pam="TTTA", gc=0.52,
        protein_residue=711, cds_fraction=0.62, in_last_exon=False,
        features_hit=("SWIRM domain",), perfect_matches=1,
        one_mismatch_matches=0,
    )
    design = mx.ArrayDesign(
        nuclease="AsCas12a", genes=("ARID1A", "ARID1B"),
        spacers=(spacer,), layout=("crRNA direct repeat", "spacer ARID1A"),
        construct="TTTAACGT", direct_repeat="TTTA",
        warnings=("one more spacer is required",),
        rationale="paired perturbation would settle the hypothesis",
        provenance={"genome": "GRCh38"},
    )
    called = {}

    def fake_design(*args, **kwargs):
        called["args"] = args
        called["kwargs"] = kwargs
        return design

    monkeypatch.setattr(api.mx, "design_pair", fake_design)
    response = client.post("/v1/multiplex/design", json={
        "target_gene": "ARID1A",
        "paralog_gene": "ARID1B",
        "nuclease": "AsCas12a",
        "direct_repeat": "TTTA",
        "rationale": "paired perturbation would settle the hypothesis",
    })

    assert response.status_code == 200
    body = response.json()
    assert called["args"] == ("ARID1A", "ARID1B")
    assert called["kwargs"]["nuclease"] == "AsCas12a"
    assert body["spacers"][0]["perfect_matches"] == 1
    assert body["spacers"][0]["features_hit"] == ["SWIRM domain"]
    assert body["complete"] is False
    assert "proposed experiment" in body["statement"].lower()


def test_multiplex_route_rejects_an_unregistered_nuclease(client):
    response = client.post("/v1/multiplex/design", json={
        "target_gene": "ARID1A", "paralog_gene": "ARID1B",
        "nuclease": "SpCas9",
    })
    assert response.status_code == 422


def test_openapi_contains_both_escape_endpoints(client):
    paths = client.get("/v1/openapi.json").json()["paths"]
    assert "/v1/escape/analyse" in paths
    assert "/v1/multiplex/design" in paths
