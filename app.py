from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

import auth
import errors
from config import get_settings
from database import get_engine, get_session_factory
from schemas import AuthorityType, Capabilities, Health


log = logging.getLogger("clean.app")

VERSION = "0.1.0"


async def _check_near(rpc_url: str) -> str:
    """Return 'ok', 'degraded', or 'unreachable'. Never raises."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                rpc_url,
                json={"jsonrpc": "2.0", "id": "health", "method": "status", "params": []},
            )
            if r.status_code == 200 and "result" in r.json():
                return "ok"
            return "degraded"
    except Exception:
        return "unreachable"


async def _check_db() -> str:
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "ok"
    except Exception:
        return "error"


@asynccontextmanager
async def lifespan(application: FastAPI):
    settings = get_settings()
    if settings.bootstrap_token:
        async with get_session_factory()() as session:
            created = await auth.bootstrap_owner(session, settings.bootstrap_token)
            if created:
                log.warning(
                    "Bootstrap owner created (id=%s). "
                    "Clear BOOTSTRAP_TOKEN and restart.",
                    created.id,
                )
    try:
        yield
    finally:
        await get_engine().dispose()


def create_app() -> FastAPI:
    application = FastAPI(
        title="Clean Exit",
        version=VERSION,
        description="Agent authority termination and verification on NEAR.",
        lifespan=lifespan,
    )

    settings = get_settings()

    if settings.cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=[
                "Authorization",
                "Content-Type",
                "X-Request-ID",
                "Idempotency-Key",
            ],
            expose_headers=["X-Request-ID"],
        )

    @application.middleware("http")
    async def _security_headers(request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    errors.install(application)

    from agents import router as agents_router
    from authority import router as authority_router

    application.include_router(agents_router, prefix="/api/v1")
    application.include_router(authority_router, prefix="/api/v1")

    @application.get("/health", response_model=Health, tags=["meta"])
    async def health() -> Health:
        db_status = await _check_db()
        near_status = await _check_near(settings.near_rpc_url)
        overall = "ok" if db_status == "ok" and near_status == "ok" else "degraded"
        return Health(
            status=overall,
            database=db_status,
            near_rpc=near_status,
            version=VERSION,
        )

    @application.get(
        "/api/v1/capabilities", response_model=Capabilities, tags=["meta"]
    )
    async def capabilities() -> Capabilities:
        can_sign, reason = settings.signing_allowed()
        revocable: list[AuthorityType] = []
        if can_sign:
            revocable.append(AuthorityType.NEAR_FUNCTION_KEY)
        return Capabilities(
            network=settings.near_network,  # type: ignore[arg-type]
            signer_configured=can_sign,
            signer_reason=reason,
            receipt_publisher_configured=settings.publisher_configured,
            contract_configured=bool(settings.receipt_contract),
            rate_limit_enabled=False,  # not implemented yet — honest report
            authority_types_registered=[
                AuthorityType.NEAR_FUNCTION_KEY,
                AuthorityType.SCHEDULED_JOB,
                AuthorityType.EXTERNAL_CREDENTIAL,
                AuthorityType.OBLIGATION,
                AuthorityType.CHILD_DELEGATION,
            ],
            authority_types_revocable=revocable,
        )

    return application


app = create_app()