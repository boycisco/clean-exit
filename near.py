from __future__ import annotations

import base64
import hashlib
from typing import Any, TYPE_CHECKING

import base58
import httpx
import json

from config import get_settings

if TYPE_CHECKING:
    from signer import Signer


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

    async def view_function_call(
        self, contract_id: str, method: str, args: dict[str, Any]
    ) -> Any:
        """Read-only contract call. Returns the parsed JSON result, or None."""
        args_bytes = json.dumps(args, separators=(",", ":")).encode("utf-8")
        args_b64 = base64.b64encode(args_bytes).decode("ascii")
        result = await self._call(
            "query",
            {
                "request_type": "call",
                "finality": "final",
                "account_id": contract_id,
                "method_name": method,
                "args_base64": args_b64,
            },
        )
        # Real NEAR RPC wraps: {"result": [bytes], "logs": [...], ...}
        # Some transports / test doubles may return the byte list directly.
        # Accept either shape.
        if isinstance(result, dict):
            byte_list = result.get("result", [])
        elif isinstance(result, list):
            byte_list = result
        else:
            byte_list = []
        raw = bytes(byte_list) if byte_list else b""
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))

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

    async def get_access_key(
        self, account_id: str, public_key: str
    ) -> dict[str, Any]:
        """Fetch a single access key by account + public key."""
        return await self._call(
            "query",
            {
                "request_type": "view_access_key",
                "finality": "final",
                "account_id": account_id,
                "public_key": public_key,
            },
        )

    async def get_latest_block_hash(self) -> bytes:
        result = await self._call("block", {"finality": "final"})
        hash_b58 = (result.get("header") or {}).get("hash")
        if not hash_b58:
            raise NearRpcUnavailable("block response missing header.hash")
        return base58.b58decode(hash_b58)

    async def broadcast_tx_commit(self, signed_tx_b64: str) -> dict[str, Any]:
        """Submit a base64-encoded signed tx and wait for commit.

        Returns dict with keys: success (bool), tx_hash (str), failure (Any | None).
        Raises NearError only if the RPC rejects the request — i.e. the
        transaction was never submitted.
        """
        result = await self._call("broadcast_tx_commit", [signed_tx_b64])
        tx_hash = (result.get("transaction") or {}).get("hash") or ""
        status_obj = result.get("status") or {}
        if "SuccessValue" in status_obj or "SuccessReceiptId" in status_obj:
            return {"success": True, "tx_hash": tx_hash, "failure": None}
        return {
            "success": False,
            "tx_hash": tx_hash,
            "failure": status_obj.get("Failure"),
        }


# ---------------------------------------------------------------------------
# Borsh serialization for NEAR transactions
# ---------------------------------------------------------------------------
# NEAR transactions are Borsh-serialized. Reference:
#   https://nomicon.io/RuntimeSpec/Transactions


def _borsh_u32(n: int) -> bytes:
    return n.to_bytes(4, "little")


def _borsh_u64(n: int) -> bytes:
    return n.to_bytes(8, "little")


def _borsh_string(s: str) -> bytes:
    encoded = s.encode("utf-8")
    return _borsh_u32(len(encoded)) + encoded


def _pubkey_bytes(pubkey: str) -> bytes:
    if not pubkey.startswith("ed25519:"):
        raise ValueError(f"unsupported key type in {pubkey!r}")
    raw = base58.b58decode(pubkey[len("ed25519:"):])
    if len(raw) != 32:
        raise ValueError(f"ed25519 public key must be 32 bytes, got {len(raw)}")
    return b"\x00" + raw


def _action_delete_key(target_pubkey: str) -> bytes:
    return b"\x06" + _pubkey_bytes(target_pubkey)


def _serialize_transaction(
    signer_id: str,
    signer_public_key: str,
    nonce: int,
    receiver_id: str,
    block_hash: bytes,
    actions: list[bytes],
) -> bytes:
    if len(block_hash) != 32:
        raise ValueError(f"block_hash must be 32 bytes, got {len(block_hash)}")
    return b"".join(
        [
            _borsh_string(signer_id),
            _pubkey_bytes(signer_public_key),
            _borsh_u64(nonce),
            _borsh_string(receiver_id),
            block_hash,
            _borsh_u32(len(actions)),
            *actions,
        ]
    )


def _serialize_signed(unsigned: bytes, signature: bytes) -> bytes:
    if len(signature) != 64:
        raise ValueError(f"signature must be 64 bytes, got {len(signature)}")
    # Signature is a Borsh enum: 1-byte variant tag (0 = Ed25519) + 64-byte signature.
    return unsigned + b"\x00" + signature


def build_delete_key_transaction(
    signer: "Signer",
    target_public_key: str,
    nonce: int,
    block_hash: bytes,
    receiver_id: str | None = None,
) -> str:
    receiver = receiver_id or signer.account_id
    unsigned = _serialize_transaction(
        signer_id=signer.account_id,
        signer_public_key=signer.public_key,
        nonce=nonce,
        receiver_id=receiver,
        block_hash=block_hash,
        actions=[_action_delete_key(target_public_key)],
    )
    tx_hash = hashlib.sha256(unsigned).digest()
    signature = signer.sign(tx_hash)
    signed = _serialize_signed(unsigned, signature)
    return base64.b64encode(signed).decode("ascii")


# ---------------------------------------------------------------------------
# Function call support (for the receipt registry contract)
# ---------------------------------------------------------------------------


def _action_function_call(method: str, args: bytes, gas: int, deposit: int) -> bytes:
    """Borsh-encode a FunctionCall action.

    Layout: variant(0x02) || method_name(String) || args(Vec<u8>)
            || gas(u64) || deposit(u128)
    """
    return (
        b"\x02"
        + _borsh_string(method)
        + _borsh_u32(len(args))
        + args
        + _borsh_u64(gas)
        + deposit.to_bytes(16, "little")
    )


def build_function_call_transaction(
    signer: "Signer",
    receiver_id: str,
    method: str,
    args: dict[str, Any],
    gas: int,
    deposit: int,
    nonce: int,
    block_hash: bytes,
) -> str:
    """Build and sign a FunctionCall transaction; return base64-encoded bytes."""
    args_bytes = json.dumps(args, separators=(",", ":")).encode("utf-8")
    unsigned = _serialize_transaction(
        signer_id=signer.account_id,
        signer_public_key=signer.public_key,
        nonce=nonce,
        receiver_id=receiver_id,
        block_hash=block_hash,
        actions=[_action_function_call(method, args_bytes, gas, deposit)],
    )
    tx_hash = hashlib.sha256(unsigned).digest()
    signature = signer.sign(tx_hash)
    signed = _serialize_signed(unsigned, signature)
    return base64.b64encode(signed).decode("ascii")


def get_rpc() -> NearRpc:
    """FastAPI dependency factory. Overridable in tests."""
    return NearRpc(get_settings().near_rpc_url)