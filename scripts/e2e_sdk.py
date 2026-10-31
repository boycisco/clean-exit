"""Clean Exit SDK End-to-End Test.

Usage:
    python scripts/e2e_sdk.py <TARGET_PUBLIC_KEY>

Example:
    python scripts/e2e_sdk.py ed25519:9Rzugrms7J8HHEcCP6wndF6GVAYkbtySYZiKgpisq2LU

Prerequisites:
    - Backend must be running (uvicorn app:app --reload)
    - The TARGET_PUBLIC_KEY must exist on the testnet account as a FunctionCall key.
"""

import os
import sys
import time

from sdk import CleanExitClient

# Configuration
TARGET_KEY = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TARGET_KEY")
URL = os.environ.get("CLEAN_EXIT_URL", "http://127.0.0.1:8000")
TOKEN = os.environ.get("CLEAN_EXIT_TOKEN", "ce_dev_test_only_do_not_use")

if not TARGET_KEY:
    print("ERROR: Provide a target public key.")
    print("Usage: python scripts/e2e_sdk.py <ed25519:...>")
    sys.exit(1)

c = CleanExitClient(URL, TOKEN)


def step(n: int, msg: str):
    print(f"\n[{n}] {msg}")


try:
    # 1. Capabilities
    step(1, "Checking capabilities...")
    caps = c.capabilities()
    print(f"    Network: {caps['network']}")
    print(f"    Signer:  {caps['signer_configured']}")
    print(f"    Publisher: {caps['receipt_publisher_configured']}")
    if not caps["signer_configured"] or not caps["receipt_publisher_configured"]:
        raise RuntimeError("Backend is not fully configured for signing/publishing.")

    # 2. Create Agent
    step(2, "Creating agent...")
    agent = c.create_agent("sdk-e2e-bot", "clean-exit-test-429622.testnet")
    agent_id = agent["id"]
    print(f"    Agent ID: {agent_id}")
    print(f"    Status:   {agent['status']}")

    # 3. Register Authority
    step(3, "Registering authority...")
    auth = c.register_authority(
        agent_id,
        type="near_function_key",
        provider="near",
        resource=TARGET_KEY,
        revocable=True,
    )
    auth_id = auth["id"]
    print(f"    Authority ID: {auth_id}")
    print(f"    State:        {auth['state']}")

    # 4. Verify On Chain
    step(4, "Verifying on chain...")
    report = c.verify_agent(agent_id)
    print(f"    Keys observed: {report['total_observed_keys']}")
    verified = [v for v in report["verified"] if v["authority_id"] == auth_id]
    if not verified:
        raise RuntimeError("Authority not found in verification report.")
    if verified[0]["on_chain"] is not True:
        raise RuntimeError(f"Key not observed on chain. Error: {report.get('error')}")
    print(f"    On-chain: {verified[0]['on_chain']} (State: {verified[0]['new_state']})")

    # 5. Plan
    step(5, "Generating termination plan...")
    plan = c.get_termination_plan(agent_id)
    print(f"    Total authorities: {plan['total_authorities']}")
    print(f"    Supported:         {plan['supported_count']}")
    if plan["supported_count"] == 0:
        raise RuntimeError("No supported authorities found in plan.")

    # 6. Terminate
    step(6, "Creating termination job...")
    idem_key = f"sdk-e2e-{int(time.time())}"
    job = c.terminate(agent_id, reason="SDK E2E Test", idempotency_key=idem_key)
    job_id = job["id"]
    print(f"    Job ID: {job_id}")
    print(f"    Status: {job['status']}")

    # 7. Wait
    step(7, "Waiting for worker to process job...")
    final = c.wait_for_termination(job_id, timeout=120, poll_interval=2)
    print(f"    Status:  {final['status']}")
    print(f"    Phase:   {final['phase']}")
    print(f"    Receipt: {final['receipt_id']}")
    if final["status"] != "succeeded":
        raise RuntimeError(f"Job failed: {final.get('error')}")
    receipt_id = final["receipt_id"]

    # 8. Publish Receipt
    step(8, "Publishing receipt on chain...")
    pub = c.publish_receipt(receipt_id)
    print(f"    Status: {pub['verification_status']}")
    print(f"    Tx:     {pub.get('onchain_tx_hash')}")
    if pub["verification_status"] != "published":
        raise RuntimeError(f"Publish failed: {pub.get('error')}")

    # 9. Verify Receipt
    step(9, "Verifying receipt integrity...")
    ver = c.verify_receipt(receipt_id)
    print(f"    Hash Matches:    {ver['hash_matches']}")
    print(f"    On-chain Status: {ver['onchain_status']}")
    print(f"    On-chain Match:  {ver['onchain_matches']}")
    print(f"    Verified:        {ver['verified']}")
    if not ver["verified"]:
        raise RuntimeError("Receipt verification failed.")

    print("\n" + "=" * 50)
    print("=== SDK E2E PASSED SUCCESSFULLY ===")
    print("=" * 50)

except Exception as e:
    print(f"\n[!] E2E FAILED: {e}")
    sys.exit(1)