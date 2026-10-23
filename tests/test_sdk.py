from __future__ import annotations

import json

import httpx
import pytest

from sdk import CleanExitClient, CleanExitError


def _client(handler) -> CleanExitClient:
    return CleanExitClient(
        "http://test", "ce_secret_token",
        transport=httpx.MockTransport(handler),
    )


def _assert_auth(request: httpx.Request) -> None:
    assert request.headers["authorization"] == "Bearer ce_secret_token"


def test_repr_never_leaks_token():
    c = CleanExitClient("http://test", "ce_very_secret_token_do_not_leak")
    text = repr(c) + str(c)
    assert "ce_very_secret_token" not in text
    assert "http://test" in text


def test_create_agent():
    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        assert request.method == "POST"
        assert request.url.path == "/api/v1/agents"
        body = json.loads(request.content)
        assert body["name"] == "tmp"
        assert body["near_account"] == "alice.testnet"
        assert body["environment"] == "testnet"
        return httpx.Response(
            201,
            json={
                "id": "abc", "name": "tmp", "near_account": "alice.testnet",
                "environment": "testnet", "status": "active",
            },
        )

    agent = _client(handler).create_agent("tmp", "alice.testnet")
    assert agent["id"] == "abc"
    assert agent["status"] == "active"


def test_list_agents_with_filter():
    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        assert request.url.path == "/api/v1/agents"
        q = dict(request.url.params)
        assert q["status"] == "clean"
        assert q["limit"] == "10"
        return httpx.Response(200, json=[])

    result = _client(handler).list_agents(status="clean", limit=10)
    assert result == []


def test_get_agent_404_raises_typed_error():
    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        return httpx.Response(
            404,
            json={"error": {"code": "not_found", "message": "Agent not found.", "details": {}}},
        )

    with pytest.raises(CleanExitError) as exc:
        _client(handler).get_agent("missing")
    assert exc.value.code == "not_found"
    assert exc.value.status_code == 404
    assert "Agent not found" in str(exc.value)


def test_401_raises_unauthorized():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={"error": {"code": "unauthorized", "message": "Missing header.", "details": {}}},
        )

    with pytest.raises(CleanExitError) as exc:
        _client(handler).get_agent("any")
    assert exc.value.code == "unauthorized"


def test_register_authority():
    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        assert request.url.path == "/api/v1/agents/agent-1/authorities"
        body = json.loads(request.content)
        assert body["type"] == "near_function_key"
        assert body["provider"] == "near"
        assert body["resource"] == "ed25519:ABC"
        assert body["revocable"] is True
        return httpx.Response(201, json={"id": "auth-1", "state": "unverified"})

    a = _client(handler).register_authority(
        "agent-1",
        type="near_function_key",
        provider="near",
        resource="ed25519:ABC",
        revocable=True,
    )
    assert a["id"] == "auth-1"


def test_get_termination_plan():
    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        assert request.url.path == "/api/v1/agents/agent-1/termination-plan"
        return httpx.Response(
            200,
            json={
                "agent_id": "agent-1", "near_account": "alice.testnet",
                "network": "testnet", "total_authorities": 0,
                "supported_count": 0, "unsupported_count": 0, "manual_count": 0,
                "steps": [], "notes": [],
            },
        )

    plan = _client(handler).get_termination_plan("agent-1")
    assert plan["agent_id"] == "agent-1"


def test_terminate_with_idempotency_key():
    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        assert request.url.path == "/api/v1/agents/agent-1/terminate"
        body = json.loads(request.content)
        assert body["idempotency_key"] == "k-42"
        assert body["reason"] == "done"
        return httpx.Response(
            202, json={"id": "job-1", "status": "pending", "phase": "validate"}
        )

    job = _client(handler).terminate(
        "agent-1", reason="done", idempotency_key="k-42"
    )
    assert job["id"] == "job-1"
    assert job["status"] == "pending"


def test_wait_for_termination_returns_on_terminal(monkeypatch):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        calls["n"] += 1
        statuses = ["pending", "running", "succeeded"]
        return httpx.Response(200, json={"id": "job-1", "status": statuses[calls["n"] - 1]})

    import sdk.client as sdk_client_module

    monkeypatch.setattr(sdk_client_module.time, "sleep", lambda _s: None)
    result = _client(handler).wait_for_termination("job-1", timeout=5.0, poll_interval=0.01)
    assert result["status"] == "succeeded"
    assert calls["n"] == 3


def test_wait_for_termination_times_out(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "job-1", "status": "running"})

    import sdk.client as sdk_client_module

    monotonic_values = iter([0.0, 0.0, 100.0])
    monkeypatch.setattr(
        sdk_client_module.time, "monotonic", lambda: next(monotonic_values)
    )
    monkeypatch.setattr(sdk_client_module.time, "sleep", lambda _s: None)

    with pytest.raises(TimeoutError):
        _client(handler).wait_for_termination("job-1", timeout=1.0, poll_interval=0.01)


def test_retry_job():
    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        assert request.method == "POST"
        assert request.url.path == "/api/v1/terminations/job-1/retry"
        return httpx.Response(202, json={"id": "job-1", "status": "pending"})

    job = _client(handler).retry_job("job-1")
    assert job["status"] == "pending"


def test_get_receipt():
    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        assert request.url.path == "/api/v1/receipts/rec-1"
        return httpx.Response(200, json={"id": "rec-1", "result": "clean"})

    receipt = _client(handler).get_receipt("rec-1")
    assert receipt["result"] == "clean"


def test_verify_receipt():
    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        assert request.url.path == "/api/v1/receipts/rec-1/verify"
        return httpx.Response(
            200,
            json={
                "receipt_id": "rec-1", "hash_matches": True,
                "verified": True, "notes": [],
            },
        )

    result = _client(handler).verify_receipt("rec-1")
    assert result["verified"] is True


def test_audit_pagination():
    def handler(request: httpx.Request) -> httpx.Response:
        _assert_auth(request)
        q = dict(request.url.params)
        assert q["limit"] == "5"
        assert q["offset"] == "10"
        return httpx.Response(200, json=[])

    result = _client(handler).get_audit("agent-1", limit=5, offset=10)
    assert result == []