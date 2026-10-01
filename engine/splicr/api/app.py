"""
The engine's service API.

An internal service, not a public one: see splicr/api/security.py for why, and
splicr/db.py for the connection it holds. Run it behind a network boundary only
service callers can reach.

    engine/.tools/env/bin/python -m uvicorn splicr.api.app:app --port 8787

Every route is versioned under /v1, authorizes its caller, and answers a typed
error rather than a stack trace. The request id in each error is also on the
response header, so a caller's log line and a server log line can be joined.
"""

from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import disagreement

API_VERSION = "1"
REQUEST_ID_HEADER = "x-splicr-request-id"


class ApiError(BaseModel):
    """The only error shape any route returns."""

    model_config = ConfigDict(extra="forbid")

    error: str
    detail: object
    request_id: str


def _error(request: Request, status: int, error: str, detail: object) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "") or str(uuid.uuid4())
    body = ApiError(error=error, detail=detail, request_id=request_id)
    return JSONResponse(status_code=status, content=body.model_dump(),
                        headers={REQUEST_ID_HEADER: request_id})


def create_app() -> FastAPI:
    application = FastAPI(
        title="SplicR engine API",
        version=API_VERSION,
        description=__doc__,
        # No interactive docs: an internal service should not publish a form that
        # invites a browser to call it.
        docs_url=None,
        redoc_url=None,
        openapi_url="/v1/openapi.json",
    )

    @application.middleware("http")
    async def tag_request(request: Request, call_next):
        request.state.request_id = (
            request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4()))
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request.state.request_id
        return response

    @application.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        response = _error(request, exc.status_code, "request_failed", exc.detail)
        for key, value in (exc.headers or {}).items():
            response.headers[key] = value
        return response

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # 422 with the field paths, so a caller that misspells a field is told
        # which one rather than handed a generic refusal. jsonable_encoder
        # because pydantic attaches the original exception object to `ctx`,
        # which json.dumps cannot render.
        return _error(request, 422, "invalid_request", jsonable_encoder(exc.errors()))

    @application.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception):
        # The type and message, never a traceback: a stack trace can carry a
        # connection string or a row of somebody's data.
        return _error(request, 500, "internal_error",
                      f"{type(exc).__name__}: {exc}")

    @application.get("/v1/health", tags=["service"])
    def health() -> dict:
        """Liveness only. It does not touch the database and proves nothing about it."""
        return {"status": "ok", "api_version": API_VERSION}

    from . import escape
    application.include_router(escape.router)
    application.include_router(disagreement.router)
    return application


app = create_app()
