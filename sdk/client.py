"""Clean Exit Python SDK.

A thin synchronous client over the Clean Exit REST API. Handles auth,
error mapping, and job polling. Never logs or exposes the API token.
"""
from __future__ import annotations

import time
from typing import Any

import httpx


TERMINAL_STATUSES = frozenset({"succeeded", "partial", "failed", "cancelled"})


class CleanExitError(Exception):
    """Raised for any non-2xx response from the Clean Exit API."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 0,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}

    def __repr__(self) -> str:
        return f"CleanExitError(code={self.code!r}, status_code={self.status_code})"


class CleanExitClient:
    """Synchronous client for the Clean Exit API.

    The token is stored on the instance and never logged or exposed via
    __repr__/__str__. Pass `transport=` to inject a mock for tests.
    """

    def __init__(
        self,
        api_url: str,
        api_token: str,
        *,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self._token = api_token
        self._timeout = timeout
        self._transport = transport

    def __repr__(self) -> str:
        return f"CleanExitClient(api_url={self.api_url!r})"

    __str__ = __repr__


    def publish_receipt(self, receipt_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/receipts/{receipt_id}/publish")

    def latest_receipt(self, agent_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/agents/{agent_id}/receipt")

    def capabilities(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/capabilities")

    # ------------------------------------------------------------------
    # Internal HTTP helper
    # ------------------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self.api_url}{path}"
        with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
            r = client.request(
                method, url, headers=self._headers(), json=json, params=params
            )

        if r.status_code == 204:
            return None

        try:
            body = r.json()
        except ValueError:
            if r.is_success:
                return r.text
            raise CleanExitError(
                "non_json_response",
                f"HTTP {r.status_code}: {r.text[:200]}",
                status_code=r.status_code,
            ) from None

        if not r.is_success:
            err = body.get("error", {}) if isinstance(body, dict) else {}
            raise CleanExitError(
                err.get("code", "http_error"),
                err.get("message", f"HTTP {r.status_code}"),
                status_code=r.status_code,
                details=err.get("details") or {},
            )

        return body

    # ------------------------------------------------------------------
    # Agents
    # ------------------------------------------------------------------

    def create_agent(
        self,
        name: str,
        near_account: str | None = None,
        *,
        environment: str = "testnet",
        description: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/agents",
            json={
                "name": name,
                "near_account": near_account,
                "environment": environment,
                "description": description,
                "meta": meta or {},
            },
        )

    def list_agents(
        self,
        *,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status:
            params["status"] = status
        return self._request("GET", "/api/v1/agents", params=params)

    def get_agent(self, agent_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/agents/{agent_id}")

    def update_agent(self, agent_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._request("PATCH", f"/api/v1/agents/{agent_id}", json=kwargs)

    # ------------------------------------------------------------------
    # Authorities
    # ------------------------------------------------------------------

    def get_authorities(self, agent_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/agents/{agent_id}/authorities")

    def register_authority(
        self,
        agent_id: str,
        *,
        type: str,
        provider: str,
        resource: str,
        parent_id: str | None = None,
        scope: dict[str, Any] | None = None,
        revocable: bool = False,
        source: str = "registered",
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/agents/{agent_id}/authorities",
            json={
                "type": type,
                "provider": provider,
                "resource": resource,
                "parent_id": parent_id,
                "scope": scope or {},
                "revocable": revocable,
                "source": source,
                "meta": meta or {},
            },
        )

    def verify_agent(self, agent_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/agents/{agent_id}/verify")

    # ------------------------------------------------------------------
    # Termination
    # ------------------------------------------------------------------

    def get_termination_plan(self, agent_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/agents/{agent_id}/termination-plan")

    def terminate(
        self,
        agent_id: str,
        *,
        reason: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/agents/{agent_id}/terminate",
            json={"reason": reason, "idempotency_key": idempotency_key},
        )

    def get_job(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/terminations/{job_id}")

    def list_jobs(self, agent_id: str) -> list[dict[str, Any]]:
        return self._request("GET", f"/api/v1/agents/{agent_id}/terminations")

    def retry_job(self, job_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/terminations/{job_id}/retry")

    def wait_for_termination(
        self,
        job_id: str,
        *,
        timeout: float = 300.0,
        poll_interval: float = 2.0,
    ) -> dict[str, Any]:
        """Poll until the job reaches a terminal status or the timeout expires."""
        deadline = time.monotonic() + timeout
        last: dict[str, Any] | None = None
        while True:
            last = self.get_job(job_id)
            if last.get("status") in TERMINAL_STATUSES:
                return last
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"job {job_id} did not reach terminal state within {timeout}s "
                    f"(last status: {last.get('status')})"
                )
            time.sleep(poll_interval)

    # ------------------------------------------------------------------
    # Receipts (endpoints delivered in Priority 4c)
    # ------------------------------------------------------------------

    def get_receipt(self, receipt_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/receipts/{receipt_id}")

    def verify_receipt(self, receipt_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/receipts/{receipt_id}/verify")

    # ------------------------------------------------------------------
    # Audit
    # ------------------------------------------------------------------

    def get_audit(
        self,
        agent_id: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        return self._request(
            "GET",
            f"/api/v1/agents/{agent_id}/audit",
            params={"limit": limit, "offset": offset},
        )