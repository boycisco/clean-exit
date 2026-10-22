from __future__ import annotations

import json
from pathlib import Path

import base58
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


class SignerError(Exception):
    """Base for signer failures. Never carries secret material."""

    code = "signer_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class SignerUnavailable(SignerError):
    code = "signer_unavailable"


class SignerInvalid(SignerError):
    code = "signer_invalid"


def _b58_pubkey(raw: bytes) -> str:
    return "ed25519:" + base58.b58encode(raw).decode()


class Signer:
    """Ed25519 signer for NEAR transactions.

    Holds a private key in memory for the lifetime of the object.
    The key is never serialized, never logged, never returned through
    any API. Load from a file; never from request bodies or the DB.
    """

    def __init__(self, account_id: str, private_key: Ed25519PrivateKey) -> None:
        self.account_id = account_id
        self._private_key = private_key
        self._public_bytes = private_key.public_key().public_bytes(
            Encoding.Raw, PublicFormat.Raw
        )
        self.public_key = _b58_pubkey(self._public_bytes)

    def __repr__(self) -> str:  # deliberately omits private key
        return f"Signer(account_id={self.account_id!r}, public_key={self.public_key!r})"

    def __str__(self) -> str:
        return self.__repr__()

    @classmethod
    def from_file(cls, path: str, expected_account: str | None = None) -> "Signer":
        p = Path(path)
        if not p.is_file():
            raise SignerUnavailable(f"signer file missing: {path}")

        try:
            raw = p.read_text(encoding="utf-8")
        except OSError as e:
            raise SignerUnavailable(f"signer file unreadable: {e}") from e

        try:
            data = json.loads(raw)
        except ValueError as e:
            raise SignerInvalid("signer file is not valid JSON") from e

        account_id = data.get("account_id")
        secret = data.get("secret_key")
        if not isinstance(account_id, str) or not account_id:
            raise SignerInvalid("signer file missing 'account_id'")
        if not isinstance(secret, str) or not secret.startswith("ed25519:"):
            raise SignerInvalid("signer 'secret_key' must start with 'ed25519:'")

        try:
            secret_bytes = base58.b58decode(secret[len("ed25519:"):])
        except ValueError as e:
            raise SignerInvalid("signer 'secret_key' is not valid base58") from e

        if len(secret_bytes) == 64:
            seed = secret_bytes[:32]  # NEAR key files: seed || pubkey
        elif len(secret_bytes) == 32:
            seed = secret_bytes
        else:
            raise SignerInvalid(
                f"invalid ed25519 secret length: {len(secret_bytes)} (expected 32 or 64)"
            )

        try:
            private_key = Ed25519PrivateKey.from_private_bytes(seed)
        except Exception as e:
            raise SignerInvalid("invalid ed25519 private key") from e

        if expected_account and account_id != expected_account:
            raise SignerInvalid(
                f"signer file account_id ({account_id}) does not match configured "
                f"account ({expected_account})"
            )

        return cls(account_id, private_key)

    def sign(self, message: bytes) -> bytes:
        return self._private_key.sign(message)

    def verify(self, message: bytes, signature: bytes) -> bool:
        try:
            self._private_key.public_key().verify(signature, message)
            return True
        except InvalidSignature:
            return False