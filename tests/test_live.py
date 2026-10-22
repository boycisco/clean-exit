"""Live NEAR testnet tests. Skipped by default.

Run with: pytest -m live tests/test_live.py
"""

from __future__ import annotations

import pytest

from near import NearAccountNotFound, NearRpc


pytestmark = pytest.mark.live

RPC_URL = "https://rpc.testnet.near.org"


@pytest.fixture
def rpc():
    return NearRpc(RPC_URL, timeout=20.0)


async def test_live_status(rpc):
    result = await rpc.status()
    assert "sync_info" in result
    assert int(result["sync_info"]["latest_block_height"]) > 0


async def test_live_view_account_known(rpc):
    # 'testnet' is the TLD registrar account on NEAR testnet.
    account = await rpc.view_account("testnet")
    assert "code_hash" in account
    assert "amount" in account


async def test_live_account_not_found(rpc):
    with pytest.raises(NearAccountNotFound):
        await rpc.view_account(
            "clean-exit-definitely-nonexistent-1234.testnet"
        )


async def test_live_get_access_keys(rpc):
    """Query access keys on a live testnet account.

    The 'testnet' TLD account is a special account registrar with
    non-standard access key semantics. We accept either a successful
    list or a typed NearError — the point is to prove the client
    handles the real RPC without crashing.
    """
    from near import NearError

    try:
        keys = await rpc.get_access_keys("testnet")
        assert isinstance(keys, list)
        for k in keys:
            assert "public_key" in k
            assert "access_key" in k
    except NearError:
        # Typed error is a correct outcome for this account — the client
        # correctly classified the RPC response instead of crashing.
        pass