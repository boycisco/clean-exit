from __future__ import annotations

import httpx
import pytest

from near import (
    NearAccountNotFound,
    NearRpc,
    NearRpcError,
    NearRpcUnavailable,
)


def _rpc_handler(payload: dict, status_code: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json=payload)

    return handler


def _rpc(handler) -> NearRpc:
    return NearRpc("http://test", transport=httpx.MockTransport(handler))


async def test_status_ok():
    rpc = _rpc(_rpc_handler({"jsonrpc": "2.0", "id": "clean",
                              "result": {"sync_info": {"latest_block_height": 100}}}))
    result = await rpc.status()
    assert result["sync_info"]["latest_block_height"] == 100


async def test_view_account_ok():
    rpc = _rpc(_rpc_handler({"jsonrpc": "2.0", "id": "clean",
                              "result": {"amount": "1000", "code_hash": "11111"}}))
    account = await rpc.view_account("alice.testnet")
    assert account["amount"] == "1000"


async def test_view_account_not_found():
    payload = {
        "jsonrpc": "2.0",
        "id": "clean",
        "error": {
            "code": -32000,
            "message": "Server error",
            "data": {
                "name": "HANDLER_ERROR",
                "cause": {
                    "name": "UNKNOWN_ACCOUNT",
                    "info": {"account_id": "nobody.testnet"},
                },
            },
        },
    }
    rpc = _rpc(_rpc_handler(payload))
    with pytest.raises(NearAccountNotFound) as exc:
        await rpc.view_account("nobody.testnet")
    assert exc.value.detail["account_id"] == "nobody.testnet"


async def test_rpc_error_propagates():
    rpc = _rpc(_rpc_handler({"jsonrpc": "2.0", "id": "clean",
                              "error": {"code": -32700, "message": "Parse error"}}))
    with pytest.raises(NearRpcError) as exc:
        await rpc.status()
    assert "Parse error" in exc.value.message


async def test_rpc_unavailable_on_connection_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    rpc = _rpc(handler)
    with pytest.raises(NearRpcUnavailable):
        await rpc.status()


async def test_rpc_unavailable_on_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="oops")

    rpc = _rpc(handler)
    with pytest.raises(NearRpcUnavailable):
        await rpc.status()


async def test_rpc_unavailable_on_non_json():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>not json</html>")

    rpc = _rpc(handler)
    with pytest.raises(NearRpcUnavailable):
        await rpc.status()


async def test_get_access_keys_ok():
    payload = {
        "jsonrpc": "2.0",
        "id": "clean",
        "result": {
            "keys": [
                {"public_key": "ed25519:AAA", "access_key": {"permission": "FullAccess"}},
                {
                    "public_key": "ed25519:BBB",
                    "access_key": {"permission": {"FunctionCall": {"receiver_id": "x.near"}}},
                },
            ]
        },
    }
    rpc = _rpc(_rpc_handler(payload))
    keys = await rpc.get_access_keys("alice.testnet")
    assert len(keys) == 2
    assert keys[0]["public_key"] == "ed25519:AAA"


async def test_get_access_keys_empty():
    rpc = _rpc(_rpc_handler({"jsonrpc": "2.0", "id": "clean", "result": {"keys": []}}))
    keys = await rpc.get_access_keys("alice.testnet")
    assert keys == []