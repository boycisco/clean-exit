from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas import AgentCreate, is_valid_near_account


@pytest.mark.parametrize(
    "account",
    [
        "alice.testnet",
        "alice.near",
        "a1.testnet",
        "abcd-123.testnet",
        "a_b_c.testnet",
        "sub.alice.testnet",
        "ab",
        "0" * 64,  # implicit account (64 hex)
        "abcdef0123456789" * 4,  # 64 hex, implicit
    ],
)
def test_valid_near_accounts(account: str):
    assert is_valid_near_account(account)


@pytest.mark.parametrize(
    "account",
    [
        "Alice.testnet",  # uppercase
        "alice.testnet.",  # trailing dot
        ".alice.testnet",  # leading dot
        "alice..testnet",  # consecutive dots
        "-alice.testnet",  # leading hyphen
        "alice-.testnet",  # trailing hyphen
        "alice testnet",  # space
        "alice!testnet",  # invalid char
        "a",  # too short
        "a" * 65,  # too long
        "",
        "alice.testnet\n",
    ],
)
def test_invalid_near_accounts(account: str):
    assert not is_valid_near_account(account)


def test_agent_create_rejects_bad_account():
    with pytest.raises(ValidationError) as excinfo:
        AgentCreate(name="x", near_account="Alice.testnet")
    assert "invalid NEAR account ID" in str(excinfo.value)


def test_agent_create_rejects_unknown_field():
    with pytest.raises(ValidationError):
        AgentCreate(name="x", typo_field="boom")  # type: ignore[call-arg]


def test_agent_create_meta_size_limit():
    with pytest.raises(ValidationError):
        AgentCreate(name="x", meta={"blob": "y" * 5000})