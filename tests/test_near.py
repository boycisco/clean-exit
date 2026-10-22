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


# ---------------------------------------------------------------------------
# Borsh / transaction construction tests
# ---------------------------------------------------------------------------

import hashlib
import base64 as b64
import base58 as b58

from near import (
    _action_delete_key,
    _borsh_string,
    _borsh_u32,
    _borsh_u64,
    _pubkey_bytes,
    _serialize_transaction,
    build_delete_key_transaction,
)
from signer import Signer


def _signer_from_rfc_seed(tmp_path) -> Signer:
    seed_hex = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
    seed = bytes.fromhex(seed_hex)
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    priv = Ed25519PrivateKey.from_private_bytes(seed)
    pub = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    expanded = seed + pub
    secret_b58 = "ed25519:" + b58.b58encode(expanded).decode()
    pubkey_b58 = "ed25519:" + b58.b58encode(pub).decode()

    p = tmp_path / "key.json"
    p.write_text(
        f'{{"account_id": "alice.testnet", '
        f'"public_key": "{pubkey_b58}", "secret_key": "{secret_b58}"}}'
    )
    return Signer.from_file(str(p))


def test_borsh_u32():
    assert _borsh_u32(0) == b"\x00\x00\x00\x00"
    assert _borsh_u32(1) == b"\x01\x00\x00\x00"
    assert _borsh_u32(256) == b"\x00\x01\x00\x00"


def test_borsh_u64():
    assert _borsh_u64(0) == b"\x00" * 8
    assert _borsh_u64(1) == b"\x01" + b"\x00" * 7


def test_borsh_string():
    assert _borsh_string("") == b"\x00\x00\x00\x00"
    assert _borsh_string("a") == b"\x01\x00\x00\x00" + b"a"
    assert _borsh_string("ab") == b"\x02\x00\x00\x00" + b"ab"


def test_pubkey_bytes():
    raw = b"\x01" * 32
    encoded = "ed25519:" + b58.b58encode(raw).decode()
    assert _pubkey_bytes(encoded) == b"\x00" + raw


def test_pubkey_bytes_rejects_non_ed25519():
    with pytest.raises(ValueError):
        _pubkey_bytes("secp256k1:abc")


def test_action_delete_key_shape():
    raw = b"\x02" * 32
    encoded = "ed25519:" + b58.b58encode(raw).decode()
    action = _action_delete_key(encoded)
    assert action[0] == 0x06  # DeleteKey variant
    assert len(action) == 1 + 1 + 32  # variant + key type + key


def test_transaction_serialization_length():
    raw_pk = b"\x03" * 32
    signer_pub = "ed25519:" + b58.b58encode(raw_pk).decode()
    target_pub = "ed25519:" + b58.b58encode(b"\x04" * 32).decode()

    unsigned = _serialize_transaction(
        signer_id="alice.testnet",
        signer_public_key=signer_pub,
        nonce=42,
        receiver_id="alice.testnet",
        block_hash=b"\x00" * 32,
        actions=[_action_delete_key(target_pub)],
    )
    # Sanity: must start with the signer_id string.
    assert unsigned.startswith(_borsh_string("alice.testnet"))
    # Nonce appears at a known offset after strings and pubkey.
    nonce_offset = (
        len(_borsh_string("alice.testnet"))
        + len(_pubkey_bytes(signer_pub))
    )
    assert unsigned[nonce_offset : nonce_offset + 8] == _borsh_u64(42)


def test_build_delete_key_transaction_roundtrip(tmp_path):
    signer = _signer_from_rfc_seed(tmp_path)
    target_pub = "ed25519:" + b58.b58encode(b"\x05" * 32).decode()
    block_hash = b"\xAA" * 32
    nonce = 12345

    signed_b64 = build_delete_key_transaction(
        signer=signer,
        target_public_key=target_pub,
        nonce=nonce,
        block_hash=block_hash,
    )
    signed = b64.b64decode(signed_b64)

    # The signature is the last 64 bytes.
    unsigned, signature = signed[:-64], signed[-64:]
    assert len(signature) == 64

    # The signature is over sha256(unsigned_tx).
    tx_hash = hashlib.sha256(unsigned).digest()
    assert signer.verify(tx_hash, signature) is True


def test_build_delete_key_transaction_rejects_wrong_block_hash(tmp_path):
    signer = _signer_from_rfc_seed(tmp_path)
    target_pub = "ed25519:" + b58.b58encode(b"\x06" * 32).decode()
    with pytest.raises(ValueError):
        build_delete_key_transaction(
            signer=signer,
            target_public_key=target_pub,
            nonce=1,
            block_hash=b"\x00" * 31,  # too short
        )