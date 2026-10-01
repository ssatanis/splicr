"""
The committed API schema is the one the models publish.

The console renders the guide-disagreement document rather than recomputing it, so
the document's shape is a contract between Python and TypeScript. The schema is
generated from the pydantic model and committed beside the TypeScript that reads
it; this test fails when the model changes and the file was not regenerated, and
`apps/web/tests/disagreement.test.mjs` fails when the TypeScript stops covering
the file. Neither side can drift quietly.

Regenerate with:

    engine/.tools/env/bin/python -m splicr schema disagreement \
      > apps/web/src/lib/data/disagreement.schema.json
"""

import json
from pathlib import Path

import pytest

from splicr.api.schemas import MODELS, schema_for

ROOT = Path(__file__).resolve().parents[2]
COMMITTED = {
    "disagreement": ROOT / "apps/web/src/lib/data/disagreement.schema.json",
    "escape": ROOT / "apps/web/src/lib/data/escape.schema.json",
}

REGENERATE = (
    "engine/.tools/env/bin/python -m splicr schema {name} > {path}"
)


@pytest.mark.parametrize("name", sorted(MODELS))
def test_every_model_has_a_committed_schema(name):
    assert name in COMMITTED, f"add a committed schema path for {name}"
    assert COMMITTED[name].exists(), f"missing {COMMITTED[name].relative_to(ROOT)}"


@pytest.mark.parametrize("name", sorted(COMMITTED))
def test_the_committed_schema_matches_the_model(name):
    expected = schema_for(name)
    actual = json.loads(COMMITTED[name].read_text())
    assert actual == expected, (
        f"{COMMITTED[name].relative_to(ROOT)} is stale. Regenerate it:\n  "
        + REGENERATE.format(name=name, path=COMMITTED[name].relative_to(ROOT))
    )


def test_the_schema_states_its_dialect_and_forbids_unknown_fields():
    schema = schema_for("disagreement")
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    # extra="forbid" on every model, so a field the console does not know about
    # cannot be smuggled into a stored document.
    assert schema["additionalProperties"] is False
    for definition in schema["$defs"].values():
        assert definition["additionalProperties"] is False, definition.get("title")


def test_the_concordance_states_are_the_ones_the_console_distinguishes():
    states = schema_for("disagreement")["$defs"]["Concordance"]["properties"]["status"]["enum"]
    # not_evaluated ("never looked up") and no_features ("looked up, found none")
    # are different facts. Collapsing them would let the console print "no curated
    # feature covers any cut" about a gene nobody annotated.
    assert "not_evaluated" in states
    assert "no_features" in states
    assert set(states) == {
        "shared_feature", "spans_features", "overlapping",
        "no_features", "not_evaluable", "not_evaluated",
    }


def test_the_report_carries_provenance_as_a_required_field():
    schema = schema_for("disagreement")
    assert "provenance" in schema["required"]
    provenance = schema["$defs"]["Provenance"]["properties"]
    for field in ("coordinate_system", "reference_versions", "measurement_source"):
        assert field in provenance
