from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Sequence

from .client import ProxyPilot, ProxyPilotError

PUBLIC_COMMANDS = {"status", "version"}


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="proxypilot", description="Control ProxyPilot from the terminal.")
    root.add_argument(
        "--base-url",
        default=os.getenv("PROXYPILOT_BASE_URL", "http://localhost:4000"),
        help="API origin (default: PROXYPILOT_BASE_URL or http://localhost:4000)",
    )
    root.add_argument(
        "--api-key",
        default=os.getenv("PROXYPILOT_API_KEY"),
        help="API key (default: PROXYPILOT_API_KEY)",
    )
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("status", help="Read API readiness.")
    commands.add_parser("version", help="Read API version.")
    commands.add_parser("me", help="Read the API-key identity.")
    commands.add_parser("providers", help="List providers.")

    proxies = commands.add_parser("proxies", help="List proxies.")
    proxies.add_argument("--provider-id")
    proxies.add_argument("--status", choices=["HEALTHY", "DEGRADED", "QUARANTINED", "DISABLED"])
    proxies.add_argument("--tag")
    proxies.add_argument("--pool-id")

    commands.add_parser("pools", help="List pools.")
    commands.add_parser("policies", help="List policies.")

    select = commands.add_parser("select", help="Select an eligible proxy from a pool.")
    select.add_argument("pool_id")

    submit = commands.add_parser("request", help="Queue a URL through a pool.")
    submit.add_argument("pool_id")
    submit.add_argument("url")
    submit.add_argument("--method", default="GET", choices=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
    submit.add_argument("--body")

    requests = commands.add_parser("requests", help="List request jobs.")
    requests.add_argument("--limit", type=int, default=20)

    request_get = commands.add_parser("request-get", help="Read a request job and its attempts.")
    request_get.add_argument("request_id")

    health = commands.add_parser("health", help="List proxy health checks.")
    health.add_argument("--proxy-id")
    health.add_argument("--limit", type=int, default=20)

    check = commands.add_parser("check", help="Queue a health check for a proxy.")
    check.add_argument("proxy_id")

    analytics = commands.add_parser("analytics", help="Read dashboard analytics.")
    analytics.add_argument("--hours", type=int, default=24)

    audit = commands.add_parser("audit", help="List organization audit events.")
    audit.add_argument("--limit", type=int, default=50)
    return root


def execute(client: ProxyPilot, args: argparse.Namespace) -> Any:
    if args.command == "status":
        return client.ready()
    if args.command == "version":
        return client.version()
    if args.command == "me":
        return client.me()
    if args.command == "providers":
        return client.providers()
    if args.command == "proxies":
        return client.proxies(
            providerId=args.provider_id,
            status=args.status,
            tag=args.tag,
            poolId=args.pool_id,
        )
    if args.command == "pools":
        return client.pools()
    if args.command == "policies":
        return client.policies()
    if args.command == "select":
        return client.select(args.pool_id)
    if args.command == "request":
        return client.submit_request(args.pool_id, args.url, method=args.method, body=args.body)
    if args.command == "requests":
        return client.requests(limit=args.limit)
    if args.command == "request-get":
        return client.request(args.request_id)
    if args.command == "health":
        return client.health_checks(proxy_id=args.proxy_id, limit=args.limit)
    if args.command == "check":
        return client.check_proxy(args.proxy_id)
    if args.command == "analytics":
        return client.analytics(hours=args.hours)
    if args.command == "audit":
        return client.audit(limit=args.limit)
    raise ProxyPilotError("Unknown command.", code="CLI_ERROR")


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command not in PUBLIC_COMMANDS and not args.api_key:
        print("PROXYPILOT_API_KEY or --api-key is required for this command.", file=sys.stderr)
        return 2
    client = ProxyPilot(api_key=args.api_key, base_url=args.base_url)
    try:
        result = execute(client, args)
    except ProxyPilotError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
