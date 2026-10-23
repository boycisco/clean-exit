//! Integration tests using near-workspaces.
//!
//! NOTE: near-workspaces sandbox tests require Linux or macOS.
//! On Windows, these are skipped; they run in CI on Ubuntu.
//! The real integration proof on Windows is a live testnet deployment.

#![cfg(not(target_os = "windows"))]

use near_workspaces::{Account, Contract};

const WASM: &[u8] =
    include_bytes!("../target/wasm32-unknown-unknown/release/registry.wasm");

async fn deploy() -> (
    near_workspaces::Worker<near_workspaces::network::Sandbox>,
    Account,
    Contract,
) {
    let worker = near_workspaces::sandbox().await.expect("sandbox start");
    let owner = worker.dev_create_account().await.expect("owner account");
    let contract = owner
        .deploy(WASM)
        .await
        .expect("deploy")
        .into_result()
        .expect("deploy succeeded");
    contract
        .call("new")
        .max_gas()
        .transact()
        .await
        .expect("new")
        .into_result()
        .expect("new succeeded");
    (worker, owner, contract)
}

#[tokio::test]
async fn owner_can_publish_and_verify() {
    let (_worker, owner, contract) = deploy().await;
    let hash = "a".repeat(64);
    owner
        .call(contract.id(), "publish")
        .args_json(serde_json::json!({
            "receipt_id": "r1",
            "payload_hash": hash,
            "agent_account": "alice.testnet",
            "schema_version": 1
        }))
        .max_gas()
        .transact()
        .await
        .expect("publish")
        .into_result()
        .expect("publish ok");

    let got: serde_json::Value = contract
        .view("get")
        .args_json(serde_json::json!({"receipt_id": "r1"}))
        .await
        .expect("get")
        .json()
        .expect("json");
    assert_eq!(got["receipt_id"], "r1");
    assert_eq!(got["payload_hash"], hash);

    let ok: bool = contract
        .view("verify")
        .args_json(serde_json::json!({"receipt_id": "r1", "expected_hash": hash}))
        .await
        .expect("verify")
        .json()
        .expect("json");
    assert!(ok);

    let count: u64 = contract
        .view("count")
        .await
        .expect("count")
        .json()
        .expect("json");
    assert_eq!(count, 1);
}

#[tokio::test]
async fn non_owner_publish_is_rejected() {
    let (worker, _owner, contract) = deploy().await;
    let stranger = worker.dev_create_account().await.expect("stranger");
    let result = stranger
        .call(contract.id(), "publish")
        .args_json(serde_json::json!({
            "receipt_id": "r1",
            "payload_hash": "a".repeat(64),
            "agent_account": null,
            "schema_version": 1
        }))
        .max_gas()
        .transact()
        .await
        .expect("tx");
    assert!(result.is_failure(), "stranger publish should fail");
}

#[tokio::test]
async fn duplicate_publish_is_rejected() {
    let (_worker, owner, contract) = deploy().await;
    owner
        .call(contract.id(), "publish")
        .args_json(serde_json::json!({
            "receipt_id": "r1",
            "payload_hash": "a".repeat(64),
            "agent_account": null,
            "schema_version": 1
        }))
        .max_gas()
        .transact()
        .await
        .expect("tx")
        .into_result()
        .expect("first publish ok");

    let second = owner
        .call(contract.id(), "publish")
        .args_json(serde_json::json!({
            "receipt_id": "r1",
            "payload_hash": "b".repeat(64),
            "agent_account": null,
            "schema_version": 1
        }))
        .max_gas()
        .transact()
        .await
        .expect("tx");
    assert!(second.is_failure(), "duplicate publish should fail");
}

#[tokio::test]
async fn unknown_receipt_verifies_false() {
    let (_worker, _owner, contract) = deploy().await;
    let ok: bool = contract
        .view("verify")
        .args_json(serde_json::json!({
            "receipt_id": "missing",
            "expected_hash": "a".repeat(64)
        }))
        .await
        .expect("verify")
        .json()
        .expect("json");
    assert!(!ok);
}