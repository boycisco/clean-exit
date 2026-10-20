from __future__ import annotations

import httpx
import pytest

from config import get_settings


@pytest.fixture
async def client(monkeypatch):
    # Avoid real network calls in tests.
    async def fake_near(rpc_url: str) -> str:
        return "ok"

    monkeypatch.setattr("app._check_near", fake_near)

    from app import create_app

    application = create_app()
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_health_ok(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["database"] == "ok"
    assert data["near_rpc"] == "ok"
    assert data["version"] == "0.1.0"


async def test_health_degraded_when_near_down(monkeypatch):
    async def fake_near(rpc_url: str) -> str:
        return "unreachable"

    monkeypatch.setattr("app._check_near", fake_near)

    from app import create_app

    application = create_app()
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "degraded"
    assert r.json()["near_rpc"] == "unreachable"


async def test_request_id_echoed(client: httpx.AsyncClient):
    r = await client.get("/health", headers={"X-Request-ID": "fixed-id-123"})
    assert r.headers["X-Request-ID"] == "fixed-id-123"


async def test_request_id_generated_when_missing(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.headers["X-Request-ID"]
    assert len(r.headers["X-Request-ID"]) >= 8


async def test_security_headers_present(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"


async def test_capabilities_reflects_settings(client: httpx.AsyncClient):
    get_settings.cache_clear()
    r = await client.get("/api/v1/capabilities")
    assert r.status_code == 200
    data = r.json()
    # No .env in CI defaults → no signer configured → empty revocable list.
    assert data["network"] in ("testnet", "mainnet")
    assert isinstance(data["signer_configured"], bool)
    assert isinstance(data["signer_reason"], str)
    assert isinstance(data["receipt_publisher_configured"], bool)
    assert data["rate_limit_enabled"] is False
    assert "near_function_key" in data["authority_types_registered"]
    if not data["signer_configured"]:
        assert data["authority_types_revocable"] == []