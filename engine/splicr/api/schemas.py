"""
The response models the console renders, and their published JSON Schema.

WHY THIS EXISTS

The console does not recompute the guide-disagreement statistics; it renders the
document the engine stored. That makes the document a contract between two
languages, and a contract nobody checks is a contract that drifts. So the schema
is generated from the pydantic model, committed next to the TypeScript that reads
it, and checked from both sides:

  engine/tests/test_api_schema.py    fails when a model changes and the committed
                                     schema was not regenerated
  apps/web/tests/disagreement.test.mjs
                                     fails when the TypeScript stops covering the
                                     schema's required fields, or accepts a shape
                                     the schema forbids

Regenerate with:

    engine/.tools/env/bin/python -m splicr schema disagreement \\
      > apps/web/src/lib/data/disagreement.schema.json
"""

from __future__ import annotations

from ..validate.domain_report import DisagreementReport
from .escape import EscapeResponse

#: Name used on the command line and in the committed file name.
MODELS = {
    "disagreement": DisagreementReport,
    "escape": EscapeResponse,
}


def schema_for(name: str) -> dict:
    """The model's response JSON Schema, with the schema dialect stated."""
    schema = MODELS[name].model_json_schema(mode="serialization")
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    return schema
