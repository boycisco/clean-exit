"""Clean Exit command-line interface.

Thin wrapper over CleanExitClient. Token comes from --token or
$CLEAN_EXIT_TOKEN; URL from --url or $CLEAN_EXIT_URL.

Usage:
    python -m sdk capabilities
    python -m sdk agent create my-agent --near-account alice.testnet
    python -m sdk verify <agent_id>
    python -m sdk terminate <agent_id> --reason "done"
    python -m sdk wait <job_id>
    python -m sdk receipt latest <agent_id>
    python -m sdk receipt publish <receipt_id>
    python -m sdk receipt verify <receipt_id>

Never prints tokens. Never accepts secrets in arguments beyond the
API token, which may be passed via env var instead.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from .client import CleanExitClient, CleanExitError


def _client(args: argparse.Namespace) -> CleanExitClient:
    token = args.token or os.environ.get("CLEAN_EXIT_TOKEN")
    if not token:
        print(
            "error: no API token; set CLEAN_EXIT_TOKEN or pass --token",
            file=sys.stderr,
        )
        sys.exit(2)
    url = args.url or os.environ.get("CLEAN_EXIT_URL", "http://127.0.0.1:8000")
    return CleanExitClient(url, token)


def _print(obj: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(obj, indent=2, default=str))
        return
    if isinstance(obj, list):
        if not obj:
            print("(empty)")
            return
        for item in obj:
            if isinstance(item, dict):
                keys = ["id", "name", "status", "result", "verification_status", "phase"]
                parts = [f"{k}={item[k]}" for k in keys if k in item]
                print(" | ".join(parts) if parts else json.dumps(item, default=str))
            else:
                print(item)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                print(f"{k}: {json.dumps(v, default=str)}")
            else:
                print(f"{k}: {v}")
    else:
        print(obj)


# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------


def _agent_create(c: CleanExitClient, a: argparse.Namespace) -> None:
    result = c.create_agent(
        a.name,
        a.near_account,
        environment=a.environment,
        description=a.description,
    )
    _print(result, a.json)


def _agent_list(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.list_agents(status=a.status, limit=a.limit), a.json)


def _agent_get(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.get_agent(a.agent_id), a.json)


def _agent_audit(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.get_audit(a.agent_id, limit=a.limit, offset=a.offset), a.json)


def _auth_register(c: CleanExitClient, a: argparse.Namespace) -> None:
    result = c.register_authority(
        a.agent_id,
        type=a.type,
        provider=a.provider,
        resource=a.resource,
        parent_id=a.parent_id,
        revocable=a.revocable,
    )
    _print(result, a.json)


def _auth_list(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.get_authorities(a.agent_id), a.json)


def _verify(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.verify_agent(a.agent_id), a.json)


def _plan(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.get_termination_plan(a.agent_id), a.json)


def _terminate(c: CleanExitClient, a: argparse.Namespace) -> None:
    job = c.terminate(a.agent_id, reason=a.reason, idempotency_key=a.idempotency_key)
    _print(job, a.json)


def _job(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.get_job(a.job_id), a.json)


def _wait(c: CleanExitClient, a: argparse.Namespace) -> None:
    try:
        job = c.wait_for_termination(
            a.job_id, timeout=a.timeout, poll_interval=a.interval
        )
        _print(job, a.json)
    except TimeoutError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)


def _retry(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.retry_job(a.job_id), a.json)


def _receipt_get(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.get_receipt(a.receipt_id), a.json)


def _receipt_publish(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.publish_receipt(a.receipt_id), a.json)


def _receipt_verify(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.verify_receipt(a.receipt_id), a.json)


def _receipt_latest(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.latest_receipt(a.agent_id), a.json)


def _capabilities(c: CleanExitClient, a: argparse.Namespace) -> None:
    _print(c.capabilities(), a.json)


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    # Parent parser carries the global flags so every subcommand can see them.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--url", help="API base URL (default: $CLEAN_EXIT_URL)")
    common.add_argument("--token", help="API token (default: $CLEAN_EXIT_TOKEN)")
    common.add_argument("--json", action="store_true", help="Machine-readable JSON output")

    p = argparse.ArgumentParser(
        prog="clean-exit",
        description="Clean Exit CLI — agent authority termination on NEAR",
        parents=[common],
    )
    sub = p.add_subparsers(dest="command", required=True)

    # capabilities
    cap = sub.add_parser("capabilities", help="Show enabled capabilities", parents=[common])
    cap.set_defaults(func=_capabilities)

    # agent
    agent = sub.add_parser("agent", help="Manage agents", parents=[common])
    agent_sub = agent.add_subparsers(dest="sub", required=True)

    a_create = agent_sub.add_parser("create", parents=[common])
    a_create.add_argument("name")
    a_create.add_argument("--near-account")
    a_create.add_argument("--environment", default="testnet", choices=["testnet", "mainnet"])
    a_create.add_argument("--description")
    a_create.set_defaults(func=_agent_create)

    a_list = agent_sub.add_parser("list", parents=[common])
    a_list.add_argument("--status")
    a_list.add_argument("--limit", type=int, default=50)
    a_list.set_defaults(func=_agent_list)

    a_get = agent_sub.add_parser("get", parents=[common])
    a_get.add_argument("agent_id")
    a_get.set_defaults(func=_agent_get)

    a_audit = agent_sub.add_parser("audit", parents=[common])
    a_audit.add_argument("agent_id")
    a_audit.add_argument("--limit", type=int, default=50)
    a_audit.add_argument("--offset", type=int, default=0)
    a_audit.set_defaults(func=_agent_audit)

    # authority
    auth = sub.add_parser("authority", help="Manage authorities", parents=[common])
    auth_sub = auth.add_subparsers(dest="sub", required=True)

    au_reg = auth_sub.add_parser("register", parents=[common])
    au_reg.add_argument("agent_id")
    au_reg.add_argument("--type", required=True)
    au_reg.add_argument("--provider", required=True)
    au_reg.add_argument("--resource", required=True)
    au_reg.add_argument("--parent-id")
    au_reg.add_argument("--revocable", action="store_true")
    au_reg.set_defaults(func=_auth_register)

    au_list = auth_sub.add_parser("list", parents=[common])
    au_list.add_argument("agent_id")
    au_list.set_defaults(func=_auth_list)

    # verify
    v = sub.add_parser("verify", help="Verify registered authorities against chain", parents=[common])
    v.add_argument("agent_id")
    v.set_defaults(func=_verify)

    # plan
    pl = sub.add_parser("plan", help="Read-only termination plan", parents=[common])
    pl.add_argument("agent_id")
    pl.set_defaults(func=_plan)

    # terminate
    t = sub.add_parser("terminate", help="Create a termination job", parents=[common])
    t.add_argument("agent_id")
    t.add_argument("--reason")
    t.add_argument("--idempotency-key")
    t.set_defaults(func=_terminate)

    # job
    j = sub.add_parser("job", help="Show a job's status", parents=[common])
    j.add_argument("job_id")
    j.set_defaults(func=_job)

    w = sub.add_parser("wait", help="Wait for job to reach terminal status", parents=[common])
    w.add_argument("job_id")
    w.add_argument("--timeout", type=float, default=300)
    w.add_argument("--interval", type=float, default=2)
    w.set_defaults(func=_wait)

    r = sub.add_parser("retry", help="Retry a failed or partial job", parents=[common])
    r.add_argument("job_id")
    r.set_defaults(func=_retry)

    # receipt
    rec = sub.add_parser("receipt", help="Manage receipts", parents=[common])
    rec_sub = rec.add_subparsers(dest="sub", required=True)

    r_get = rec_sub.add_parser("get", parents=[common])
    r_get.add_argument("receipt_id")
    r_get.set_defaults(func=_receipt_get)

    r_pub = rec_sub.add_parser("publish", parents=[common])
    r_pub.add_argument("receipt_id")
    r_pub.set_defaults(func=_receipt_publish)

    r_ver = rec_sub.add_parser("verify", parents=[common])
    r_ver.add_argument("receipt_id")
    r_ver.set_defaults(func=_receipt_verify)

    r_lat = rec_sub.add_parser("latest", parents=[common])
    r_lat.add_argument("agent_id")
    r_lat.set_defaults(func=_receipt_latest)

    return p


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    client = _client(args)
    try:
        args.func(client, args)
    except CleanExitError as e:
        if args.json:
            print(json.dumps({"error": {"code": e.code, "message": e.message, "status_code": e.status_code}}, indent=2))
        else:
            print(f"error [{e.code}]: {e.message}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()