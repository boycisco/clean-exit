from __future__ import annotations

import base58
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from signer import Signer, SignerInvalid, SignerUnavailable


# RFC 8032 §7.1 Ed25519 test vector #1
# https://datatracker.ietf.org/doc/html/rfc8032#section-7.1
RFC_SEED_HEX = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
RFC_PUB_HEX = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
RFC_MESSAGE_HEX = ""
RFC_SIGNATURE_HEX = (
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
)


def _ed25519_secret_b58(seed_hex: str, *, expanded: bool) -> str:
    seed = bytes.fromhex(seed_hex)
    if expanded:
        priv = Ed25519PrivateKey.from_private_bytes(seed)
        pub = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        raw = seed + pub  # 64-byte NEAR-style expanded secret
    else:
        raw = seed  # 32-byte seed-only
    return "ed25519:" + base58.b58encode(raw).decode()


def _write_key(tmp_path, account: str, secret: str) -> str:
    p = tmp_path / "key.json"
    p.write_text(
        f'{{"account_id": "{account}", "public_key": "ed25519:PLACEHOLDER", '
        f'"secret_key": "{secret}"}}'
    )
    return str(p)


def test_load_expanded_secret(tmp_path):
    path = _write_key(tmp_path, "alice.testnet", _ed25519_secret_b58(RFC_SEED_HEX, expanded=True))
    s = Signer.from_file(path)
    assert s.account_id == "alice.testnet"
    assert s.public_key == "ed25519:" + base58.b58encode(bytes.fromhex(RFC_PUB_HEX)).decode()


def test_load_seed_only_secret(tmp_path):
    path = _write_key(tmp_path, "alice.testnet", _ed25519_secret_b58(RFC_SEED_HEX, expanded=False))
    s = Signer.from_file(path)
    assert s.public_key == "ed25519:" + base58.b58encode(bytes.fromhex(RFC_PUB_HEX)).decode()


def test_rfc8032_signature_vector(tmp_path):
    path = _write_key(tmp_path, "alice.testnet", _ed25519_secret_b58(RFC_SEED_HEX, expanded=True))
    s = Signer.from_file(path)
    sig = s.sign(bytes.fromhex(RFC_MESSAGE_HEX))
    assert sig.hex() == RFC_SIGNATURE_HEX


def test_repr_never_leaks_key(tmp_path):
    path = _write_key(tmp_path, "alice.testnet", _ed25519_secret_b58(RFC_SEED_HEX, expanded=True))
    s = Signer.from_file(path)
    text = repr(s) + str(s)
    # Repr must contain the public key but never the base58 private portion.
    assert "alice.testnet" in text
    assert "ed25519:" in text
    # The seed in hex or base58 form must not appear.
    seed_hex = RFC_SEED_HEX.lower()
    seed_b58 = base58.b58encode(bytes.fromhex(RFC_SEED_HEX)).decode()
    assert seed_hex not in text.lower()
    assert seed_b58 not in text


def test_missing_file_raises_unavailable(tmp_path):
    with pytest.raises(SignerUnavailable):
        Signer.from_file(str(tmp_path / "missing.json"))


def test_bad_json_raises_invalid(tmp_path):
    p = tmp_path / "key.json"
    p.write_text("not-json{")
    with pytest.raises(SignerInvalid):
        Signer.from_file(str(p))


def test_missing_account_id_raises_invalid(tmp_path):
    p = tmp_path / "key.json"
    p.write_text('{"secret_key": "ed25519:abc"}')
    with pytest.raises(SignerInvalid):
        Signer.from_file(str(p))


def test_non_ed25519_secret_raises_invalid(tmp_path):
    p = tmp_path / "key.json"
    p.write_text('{"account_id": "a", "secret_key": "secp256k1:abc"}')
    with pytest.raises(SignerInvalid):
        Signer.from_file(str(p))


def test_bad_base58_raises_invalid(tmp_path):
    p = tmp_path / "key.json"
    p.write_text('{"account_id": "a", "secret_key": "ed25519:!!!notbase58"}')
    with pytest.raises(SignerInvalid):
        Signer.from_file(str(p))


def test_wrong_length_secret_raises_invalid(tmp_path):
    p = tmp_path / "key.json"
    p.write_text('{"account_id": "a", "secret_key": "ed25519:abc"}')
    with pytest.raises(SignerInvalid):
        Signer.from_file(str(p))


def test_account_mismatch_raises_invalid(tmp_path):
    path = _write_key(tmp_path, "alice.testnet", _ed25519_secret_b58(RFC_SEED_HEX, expanded=True))
    with pytest.raises(SignerInvalid):
        Signer.from_file(path, expected_account="bob.testnet")