"""
HTTP adapters for the engine's deterministic analysis modules.

An internal service. It holds the Postgres secret key and bypasses Row Level
Security, so nothing a browser can reach may call it; every route authorizes its
caller explicitly. See `security.py` for the contract and `app.py` for how to run
it. The science lives in `splicr.validate` and is not duplicated here: these
modules validate, authorize and serialize.
"""

from .app import API_VERSION, app, create_app

__all__ = ["API_VERSION", "app", "create_app"]
