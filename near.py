from __future__ import annotations

from typing import Any

import httpx

from config import get_settings


class NearError(Exception):
    """Base exception for NEAR RPC failures."""

    code: str = "near_error"

    def __init__(self, message: str, *, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail or {}


class NearAccountNotFound(NearError):
    code = "account_not_found"


class NearRpcUnavailable(NearError):
    code = "rpc_unavailable"


class NearRpcError(NearError):
    code = "rpc_error"


class NearRpc:
    """Thin async client for NEAR JSON-RPC.

    Keeps no state across calls; instances are cheap. Tests inject
    `transport=` to mock at the HTTP boundary without touching
    application logic.
    """

    def __init__(
        self,
        rpc_url: str,
        timeout: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.rpc_url = rpc_url.rstrip("/")
        self.timeout = timeout
        self._transport = transport

    async def _call(self, method: str, params: Any) -> dict[str, Any]:
        payload = {"jsonrpc": "2.0", "id": "clean", "method": method, "params": params}
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout, transport=self._transport
            ) as client:
                r = await client.post(self.rpc_url, json=payload)
        except httpx.HTTPError as e:
            raise NearRpcUnavailable(f"NEAR RPC unreachable: {e}") from e

        if r.status_code != 200:
            raise NearRpcUnavailable(
                f"NEAR RPC HTTP {r.status_code}",
                detail={"body": r.text[:200]},
            )

        try:
            data = r.json()
        except ValueError as e:
            raise NearRpcUnavailable("NEAR RPC returned non-JSON") from e

        if "error" in data:
            err = data["error"]

            # Locate an UNKNOWN_ACCOUNT cause across several possible
            # response shapes from different nearcore versions:
            #   - cause at the top level of error  (most common today)
            #   - cause nested inside data (dict)
            #   - data is a string with a "does not exist" message
            cause: dict[str, Any] | None = None
            if isinstance(err.get("cause"), dict):
                cause = err["cause"]
            else:
                data_field = err.get("data")
                if isinstance(data_field, dict):
                    if isinstance(data_field.get("cause"), dict):
                        cause = data_field["cause"]
                    elif data_field.get("name"):
                        cause = data_field

            if isinstance(cause, dict) and cause.get("name") == "UNKNOWN_ACCOUNT":
                info = cause.get("info") or {}
                account_id = info.get("account_id", "")
                raise NearAccountNotFound(
                    f"account not found: {account_id}",
                    detail={"account_id": account_id},
                )

            # Fallback: string data carries the not-found signal
            data_str = err.get("data")
            if isinstance(data_str, str) and (
                "does not exist while viewing" in data_str
                or "UNKNOWN_ACCOUNT" in data_str
                or "AccountDoesNotExist" in data_str
            ):
                raise NearAccountNotFound(
                    f"account not found: {data_str}",
                    detail={"raw": data_str},
                )

            raise NearRpcError(
                err.get("message", "NEAR RPC error"),
                detail={"error": err},
            )

        if "result" not in data:
            raise NearRpcUnavailable("NEAR RPC response missing 'result'")

        return data["result"]

    async def status(self) -> dict[str, Any]:
        return await self._call("status", [])

    async def view_account(self, account_id: str) -> dict[str, Any]:
        return await self._call(
            "query",
            {
                "request_type": "view_account",
                "finality": "final",
                "account_id": account_id,
            },
        )

    async def get_access_keys(self, account_id: str) -> list[dict[str, Any]]:
        result = await self._call(
            "query",
            {
                "request_type": "view_access_key_list",
                "finality": "final",
                "account_id": account_id,
            },
        )
        return result.get("keys", [])


def get_rpc() -> NearRpc:
    """FastAPI dependency factory. Overridable in tests."""
    return NearRpc(get_settings().near_rpc_url)