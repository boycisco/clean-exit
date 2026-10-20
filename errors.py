from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


log = logging.getLogger("clean.errors")


class ApiError(Exception):
    """Application error with a stable code and HTTP status."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


def _envelope(
    code: str,
    message: str,
    details: dict[str, Any] | None,
    request_id: str | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        }
    }
    if request_id:
        body["error"]["request_id"] = request_id
    return body


_PRIMITIVES = (str, int, float, bool, type(None))


def _safe_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Make Pydantic v2 validation errors JSON-serializable.

    Pydantic v2 attaches the original exception instance under
    ctx.error for value_error cases. json.dumps cannot serialize a
    live exception, so we convert every non-primitive ctx value to
    its string form. The 'msg' field already carries the human
    message, so no information is lost.
    """
    safe: list[dict[str, Any]] = []
    for err in errors:
        item = {k: v for k, v in err.items() if k != "ctx"}
        ctx = err.get("ctx")
        if isinstance(ctx, dict):
            item["ctx"] = {
                k: v if isinstance(v, _PRIMITIVES) else str(v)
                for k, v in ctx.items()
            }
        safe.append(item)
    return safe


def install(app: FastAPI) -> None:
    """Register all exception handlers on the given FastAPI app."""

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        rid = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, exc.message, exc.details, rid),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        rid = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=422,
            content=_envelope(
                "validation_error",
                "Request validation failed.",
                {"errors": _safe_errors(exc.errors())},
                rid,
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        rid = getattr(request.state, "request_id", None)
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope("http_error", detail, {}, rid),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        rid = getattr(request.state, "request_id", None)
        log.exception("Unhandled error", extra={"request_id": rid})
        return JSONResponse(
            status_code=500,
            content=_envelope("internal_error", "An unexpected error occurred.", {}, rid),
        )