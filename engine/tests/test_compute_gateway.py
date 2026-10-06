from types import SimpleNamespace
from pathlib import Path
import ast
import pytest
from splicr.compute_gateway import dispatch, validate_dispatch


@pytest.mark.parametrize("payload", [{}, {"kind": "other"}, {"kind": "private", "count": True}, {"kind": "private", "count": 0}, {"kind": "private", "count": 65}, {"kind": "private", "count": 1.1}, {"kind": "private", "count": "2"}, {"kind": "public", "count": 2}, {"kind": "health", "count": 2}, {"kind": "private", "org_id": "arbitrary"}])
def test_invalid_payloads_do_not_dispatch(payload):
    calls = []
    with pytest.raises(ValueError):
        dispatch(payload, public=lambda: calls.append("public"), private=lambda: calls.append("private"))
    assert not calls


def test_dispatch_is_bounded_and_health_never_enqueues():
    calls = []
    def call():
        calls.append(1)
        return SimpleNamespace(object_id=f"fc-{len(calls)}")
    result = dispatch({"kind": "private", "count": 64}, public=call, private=call)
    assert result["accepted"] and len(calls) == len(result["call_ids"]) == 64
    assert dispatch({"kind": "public"}, public=call, private=call)["kind"] == "public"
    assert validate_dispatch({"kind": "health"}) == ("health", 1)
    with pytest.raises(ValueError):
        dispatch({"kind": "health"}, public=call, private=call)
    assert len(calls) == 65


def test_deployed_web_functions_require_proxy_auth():
    source = Path(__file__).parents[1] / "modal_app.py"
    endpoints = 0
    for node in ast.walk(ast.parse(source.read_text())):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for deco in node.decorator_list:
            if isinstance(deco, ast.Call) and isinstance(deco.func, ast.Attribute) and deco.func.attr in {"fastapi_endpoint", "asgi_app", "wsgi_app", "web_server"}:
                endpoints += 1
                assert any(key.arg == "requires_proxy_auth" and isinstance(key.value, ast.Constant) and key.value.value is True for key in deco.keywords), node.name
    assert endpoints >= 1
