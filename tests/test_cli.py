from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from sdk import CleanExitClient, CleanExitError
from sdk.cli import main


@pytest.fixture
def mock_client(monkeypatch):
    mock = MagicMock(spec=CleanExitClient)
    monkeypatch.setattr("sdk.cli._client", lambda a: mock)
    return mock


def test_no_token_exits(monkeypatch):
    monkeypatch.delenv("CLEAN_EXIT_TOKEN", raising=False)
    with pytest.raises(SystemExit) as exc:
        main(["agent", "list"])
    assert exc.value.code == 2


def test_agent_create(mock_client, capsys):
    mock_client.create_agent.return_value = {"id": "a1", "name": "x", "status": "active"}
    main(["agent", "create", "x", "--near-account", "alice.testnet", "--json"])
    mock_client.create_agent.assert_called_once_with(
        "x", "alice.testnet", environment="testnet", description=None
    )
    assert json.loads(capsys.readouterr().out)["id"] == "a1"


def test_agent_get(mock_client, capsys):
    mock_client.get_agent.return_value = {"id": "a1", "name": "demo", "status": "active"}
    main(["agent", "get", "a1", "--json"])
    mock_client.get_agent.assert_called_once_with("a1")
    assert json.loads(capsys.readouterr().out)["id"] == "a1"


def test_agent_list(mock_client, capsys):
    mock_client.list_agents.return_value = [{"id": "a1"}, {"id": "a2"}]
    main(["agent", "list", "--status", "active", "--json"])
    mock_client.list_agents.assert_called_once_with(status="active", limit=50)
    assert len(json.loads(capsys.readouterr().out)) == 2


def test_verify(mock_client):
    mock_client.verify_agent.return_value = {"account_exists": True, "total_observed_keys": 2}
    main(["verify", "a1", "--json"])
    mock_client.verify_agent.assert_called_once_with("a1")


def test_plan(mock_client):
    mock_client.get_termination_plan.return_value = {"total_authorities": 0, "steps": []}
    main(["plan", "a1", "--json"])
    mock_client.get_termination_plan.assert_called_once_with("a1")


def test_terminate(mock_client):
    mock_client.terminate.return_value = {"id": "j1", "status": "pending"}
    main(["terminate", "a1", "--reason", "done", "--idempotency-key", "k1", "--json"])
    mock_client.terminate.assert_called_once_with("a1", reason="done", idempotency_key="k1")


def test_wait_success(mock_client):
    mock_client.wait_for_termination.return_value = {"id": "j1", "status": "succeeded"}
    main(["wait", "j1", "--json"])
    mock_client.wait_for_termination.assert_called_once()


def test_wait_timeout(mock_client):
    mock_client.wait_for_termination.side_effect = TimeoutError("no terminal state")
    with pytest.raises(SystemExit) as exc:
        main(["wait", "j1"])
    assert exc.value.code == 1


def test_receipt_publish(mock_client):
    mock_client.publish_receipt.return_value = {
        "verification_status": "published",
        "onchain_tx_hash": "TX",
    }
    main(["receipt", "publish", "r1", "--json"])
    mock_client.publish_receipt.assert_called_once_with("r1")


def test_receipt_verify(mock_client, capsys):
    mock_client.verify_receipt.return_value = {"verified": True, "hash_matches": True}
    main(["receipt", "verify", "r1", "--json"])
    mock_client.verify_receipt.assert_called_once_with("r1")
    assert json.loads(capsys.readouterr().out)["verified"] is True


def test_receipt_latest(mock_client):
    mock_client.latest_receipt.return_value = {"id": "r1", "result": "clean"}
    main(["receipt", "latest", "a1", "--json"])
    mock_client.latest_receipt.assert_called_once_with("a1")


def test_capabilities(mock_client):
    mock_client.capabilities.return_value = {"network": "testnet", "signer_configured": True}
    main(["capabilities", "--json"])
    mock_client.capabilities.assert_called_once()


def test_error_maps_to_exit_code(mock_client, capsys):
    mock_client.get_agent.side_effect = CleanExitError("not_found", "missing", status_code=404)
    with pytest.raises(SystemExit) as exc:
        main(["agent", "get", "missing", "--json"])
    assert exc.value.code == 1
    out = json.loads(capsys.readouterr().out)
    assert out["error"]["code"] == "not_found"


def test_human_output(mock_client, capsys):
    mock_client.get_agent.return_value = {"id": "a1", "name": "demo", "status": "active"}
    main(["agent", "get", "a1"])
    out = capsys.readouterr().out
    assert "id: a1" in out
    assert "status: active" in out


def test_auth_register(mock_client):
    mock_client.register_authority.return_value = {"id": "au1"}
    main([
        "authority", "register", "a1",
        "--type", "near_function_key",
        "--provider", "near",
        "--resource", "ed25519:ABC",
        "--revocable",
        "--json",
    ])
    mock_client.register_authority.assert_called_once_with(
        "a1",
        type="near_function_key",
        provider="near",
        resource="ed25519:ABC",
        parent_id=None,
        revocable=True,
    )