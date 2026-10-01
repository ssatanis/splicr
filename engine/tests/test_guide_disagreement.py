"""
Guide disagreement: the arithmetic, the concordance table, and the HTTP contract.

The point of these tests is the claims the report is allowed to make. The old
endpoint answered `structural_vulnerability: confirmed` whenever a gene's
depleting guides happened to share one annotated feature, which is a conclusion
four correlated guides cannot support. What replaced it reports the 2x2 table,
its exact p-value, the smallest p that table could ever have reached, and the
correlation that makes even a small p weaker than it looks. So the tests below
check for the absence of the verdict as carefully as they check the numbers.
"""

import re
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from splicr.api import create_app, security
from splicr.api import disagreement as api
from splicr.validate import domain_report as core

HUMAN = 9606


# --------------------------------------------------------------------------
# Fixtures: a resolver and a protein annotation that answer without a network
# --------------------------------------------------------------------------

class Genes:
    """Resolves one gene, refuses everything else, like the real gate."""

    def resolve(self, value):
        if str(value).upper().split(".")[0] in ("PARP1", "ENSG00000143799"):
            return SimpleNamespace(ok=True, id="ENSG00000143799", label="PARP1",
                                   reason=None, status="resolved", candidates=())
        return SimpleNamespace(ok=False, id=None, label=None, reason="no match",
                               status="unresolved", candidates=())


#: Residues, keyed by the cut position the request supplies.
RESIDUES = {1000: 988, 2000: 45, 3000: 412, 4000: 694}
FEATURES = {
    988: ("PARP catalytic domain",),
    45: ("Zinc finger PARP-type 1",),
    412: (),
    694: ("WGR domain",),
}


def _position(residue: int):
    return SimpleNamespace(
        residue=residue, n_residues=1014, transcript="ENST00000366794",
        strand="+", exon_number=3, n_exons=23, fraction=residue / 1014,
        in_last_exon=False,
    )


@pytest.fixture
def client(monkeypatch):
    """A client whose key authenticates and whose references answer locally."""
    monkeypatch.setattr(api.harmonize, "genes", lambda taxid: Genes())
    monkeypatch.setattr(api.protein, "locate",
                        lambda gene, chrom, cut: _position(RESIDUES[int(cut)])
                        if int(cut) in RESIDUES else None)
    monkeypatch.setattr(api.protein, "domains_at",
                        lambda gene, residue: FEATURES.get(residue, ()))
    monkeypatch.setattr(api.protein, "feature_records",
                        lambda gene: ("P09874", ()))
    monkeypatch.setattr(api.protein, "flush_features", lambda: False)

    caller = security.Caller(
        key_id="k", key_name="test", org_id="org", org_slug="lab",
        scopes=(security.HITS_READ,), _key_hash="x" * 64)
    application = create_app()
    application.dependency_overrides[security.authenticate] = lambda: caller
    return TestClient(application)


def guide(key, lfc, cut=None, gene="PARP1", **extra):
    row = {"guide_key": key, "gene": gene, "log2_fold_change": lfc, **extra}
    if cut is not None:
        row |= {"chromosome": "1", "cut_position": cut}
    return row


def post(client, **body):
    return client.post("/v1/guide-disagreement",
                       json={"gene": "PARP1", **body},
                       headers={"authorization": "Bearer spk_test_x"})


# --------------------------------------------------------------------------
# The arithmetic
# --------------------------------------------------------------------------

def test_residuals_sum_to_zero_and_the_spread_is_the_sample_sd():
    rows = [core.GuideEvidence(guide_key=k, log2_fold_change=v, residual=0.0,
                         depleted=v <= api.DEPLETION_LFC)
            for k, v in (("a", -2.0), ("b", 0.0), ("c", 0.1))]
    report = core.build_report(
        "PARP1", rows, ensembl_gene_id=None, uniprot_accession=None,
        mane_transcript=None, n_residues=None, depletion_lfc=api.DEPLETION_LFC,
        baseline=None, baseline_n_genes=None,
        provenance=core.Provenance(reference_versions={}, measurement_source="test"))
    assert sum(g.residual for g in report.guides) == pytest.approx(0.0)
    assert report.mean_log2_fold_change == pytest.approx(-0.6333333, abs=1e-6)
    assert report.spread == pytest.approx(1.184624, abs=1e-6)
    assert report.n_depleting == 1
    # Sorted by effect, most depleted first, so the reader's eye lands on it.
    assert [g.guide_key for g in report.guides] == ["a", "b", "c"]


def test_a_call_that_flips_when_one_guide_is_dropped_is_reported_fragile():
    # Mean -0.70 is a depleting call; dropping the one strong guide moves it to
    # -0.05, on the other side of the -0.5 threshold.
    rows = [core.GuideEvidence(guide_key=k, log2_fold_change=v, residual=0.0,
                         depleted=v <= api.DEPLETION_LFC)
            for k, v in (("strong", -2.0), ("flat", -0.05), ("flat2", -0.05))]
    report = core.build_report(
        "PARP1", rows, ensembl_gene_id=None, uniprot_accession=None,
        mane_transcript=None, n_residues=None, depletion_lfc=api.DEPLETION_LFC,
        baseline=None, baseline_n_genes=None,
        provenance=core.Provenance(reference_versions={}, measurement_source="test"))
    assert report.fragile is True
    assert report.pivotal_guide == "strong"
    assert "fragile" in report.summary
    # A fragile call names no winning guide: that is the claim the repository's
    # own measurements say cannot be made.
    assert "correct" not in report.summary and "right guide" not in report.summary


def test_spread_is_judged_against_the_screen_and_not_an_absolute_cut(client):
    """The same gene is discordant in a quiet screen and ordinary in a noisy one."""
    gene_guides = [guide("a", -2.0), guide("b", 0.0), guide("c", 0.1)]

    def screen(noise):
        out = []
        for i in range(40):
            out += [guide(f"s{i}_1", -noise, gene=f"G{i}"),
                    guide(f"s{i}_2", +noise, gene=f"G{i}"),
                    guide(f"s{i}_3", 0.0, gene=f"G{i}")]
        return out

    quiet = post(client, guides=gene_guides, screen_guides=screen(0.1)).json()
    noisy = post(client, guides=gene_guides, screen_guides=screen(2.0)).json()
    assert quiet["spread"] == noisy["spread"]           # same gene, same numbers
    assert quiet["spread_vs_screen"] > noisy["spread_vs_screen"]
    assert quiet["discordant"] is True
    assert noisy["discordant"] is False
    assert quiet["spread_baseline_n_genes"] == 40


def test_without_the_screen_the_ratio_is_absent_rather_than_assumed(client):
    body = post(client, guides=[guide("a", -2.0), guide("b", 0.0)]).json()
    assert body["spread_vs_screen"] is None
    assert body["discordant"] is False
    assert "was not supplied" in body["summary"]


# --------------------------------------------------------------------------
# The concordance table, and what it refuses to conclude
# --------------------------------------------------------------------------

def test_shared_feature_reports_the_table_and_never_confirms_a_conclusion(client):
    body = post(client, guides=[
        guide("s1", -2.84, cut=1000),   # PARP catalytic
        guide("s2", -0.12, cut=2000),   # Zinc finger
        guide("s3", 0.03, cut=3000),    # no feature
        guide("s4", -0.27, cut=4000),   # WGR
    ]).json()
    c = body["concordance"]
    assert c["status"] == "shared_feature"
    assert c["feature"] == "PARP catalytic domain"
    assert c["n_depleting_annotated"] == 1
    assert c["n_other_annotated"] == 2      # s3 resolved but has no feature
    assert 0 < c["fisher_p"] <= 1
    # With one depleting annotated guide the table could never have been
    # evidence, and the floor says so.
    assert c["fisher_p_floor"] == pytest.approx(c["fisher_p"])
    assert c["fisher_p_floor"] > 0.05
    assert "does not establish it" in c["interpretation"]
    assert "correlated" in c["confound"]

    text = str(body).lower()
    # Word boundaries: "provenance" must not trip the ban on "proven".
    for forbidden in (r"vulnerability confirmed", r"\bproven\b", r"\bvalidated\b",
                      r"\bconfirms?\b", r"\bestablishes\b"):
        assert not re.search(forbidden, text), forbidden


def test_a_non_depleting_guide_in_the_same_feature_breaks_the_separation(client):
    # Two guides cut the catalytic domain; one depletes and one does not.
    body = post(client, guides=[
        guide("s1", -2.84, cut=1000),
        guide("s2", -0.10, cut=1000, **{}) | {"guide_key": "s2", "cut_position": 1000},
        guide("s3", -0.20, cut=4000),
    ]).json()
    assert body["concordance"]["status"] == "overlapping"
    assert "is not what separates" in body["concordance"]["interpretation"]


def test_depleting_guides_in_different_features_are_not_localised(client):
    body = post(client, guides=[
        guide("s1", -2.84, cut=1000),   # PARP catalytic
        guide("s2", -2.10, cut=4000),   # WGR
        guide("s3", 0.05, cut=2000),    # Zinc finger
    ]).json()
    assert body["concordance"]["status"] == "spans_features"
    assert body["concordance"]["feature"] is None


def test_no_annotation_says_nothing_about_the_protein(client):
    body = post(client, guides=[guide("a", -2.0), guide("b", 0.0)]).json()
    assert body["concordance"]["status"] == "no_features"
    assert body["concordance"]["fisher_p"] is None
    assert all(g["annotation_evidence"] == "none" for g in body["guides"])
    assert all(g["note"] for g in body["guides"])


def test_a_cut_outside_the_mane_cds_is_empty_and_says_why(client):
    body = post(client, guides=[guide("a", -2.0, cut=999999),
                                guide("b", 0.0, cut=1000)]).json()
    outside = next(g for g in body["guides"] if g["guide_key"] == "a")
    assert outside["protein_residue"] is None
    assert outside["note"] == "no MANE Select CDS covers this cut"


def test_the_fisher_test_is_exact_on_the_tables_it_is_given():
    # Textbook 2x2: [[3, 0], [0, 3]] has two-sided p = 0.1 exactly.
    assert core._fisher_exact_two_sided(3, 0, 0, 3) == pytest.approx(0.1)
    # Perfect separation at 4 vs 4 reaches 1/35 both ways.
    assert core._fisher_exact_two_sided(4, 0, 0, 4) == pytest.approx(2 / 70)
    # A degenerate margin can say nothing.
    assert core._fisher_exact_two_sided(2, 0, 2, 0) == pytest.approx(1.0)
    # The floor is attainable and is never below the observed minimum.
    assert core._fisher_p_floor(3, 3, 3) == pytest.approx(0.1)


# --------------------------------------------------------------------------
# Provenance and the HTTP contract
# --------------------------------------------------------------------------

def test_every_report_names_its_coordinate_system_and_reference_releases(client):
    body = post(client, guides=[guide("a", -2.0, cut=1000), guide("b", 0.0, cut=2000)]).json()
    p = body["provenance"]
    assert "MANE Select" in p["coordinate_system"]
    assert p["reference_versions"]["ensembl"] == "116"
    assert p["reference_versions"]["assembly"] == "GRCh38"
    assert p["measurement_source"] == "supplied by the caller in this request"
    assert body["mane_transcript"] == "ENST00000366794"
    assert body["ensembl_gene_id"] == "ENSG00000143799"


def test_an_unresolvable_gene_and_an_unknown_field_are_both_refused(client):
    unknown = client.post("/v1/guide-disagreement",
                          json={"gene": "NOT_A_GENE",
                                "guides": [guide("a", -2.0), guide("b", 0.0)]},
                          headers={"authorization": "Bearer spk_test_x"})
    assert unknown.status_code == 422
    assert "did not resolve" in str(unknown.json()["detail"])

    extra = client.post("/v1/guide-disagreement",
                        json={"gene": "PARP1", "branding": "no",
                              "guides": [guide("a", -2.0), guide("b", 0.0)]},
                        headers={"authorization": "Bearer spk_test_x"})
    assert extra.status_code == 422
    assert extra.json()["error"] == "invalid_request"


def test_one_guide_is_not_a_disagreement(client):
    response = client.post("/v1/guide-disagreement",
                           json={"gene": "PARP1", "guides": [guide("a", -2.0)]},
                           headers={"authorization": "Bearer spk_test_x"})
    assert response.status_code == 422


def test_duplicate_guide_keys_are_refused(client):
    response = post(client, guides=[guide("a", -2.0), guide("a", 0.0)])
    assert response.status_code == 422


def test_half_a_coordinate_is_refused_rather_than_half_annotated(client):
    response = client.post(
        "/v1/guide-disagreement",
        json={"gene": "PARP1", "guides": [
            {"guide_key": "a", "gene": "PARP1", "log2_fold_change": -2.0,
             "chromosome": "1"},
            guide("b", 0.0)]},
        headers={"authorization": "Bearer spk_test_x"})
    assert response.status_code == 422
    assert "together" in str(response.json()["detail"])


def test_every_error_carries_a_request_id_on_the_body_and_the_header(client):
    response = client.post("/v1/guide-disagreement", json={"gene": "PARP1", "guides": []},
                           headers={"authorization": "Bearer spk_test_x"})
    assert response.status_code == 422
    assert response.json()["request_id"] == response.headers["x-splicr-request-id"]


def test_the_service_publishes_no_interactive_docs(client):
    # An internal service should not hand a browser a form that calls it.
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
