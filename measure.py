#!/usr/bin/env python3
"""
measure.py — Performance harness for silas-content-system dashboard endpoints.

Inspired by Karpathy's autoresearch pattern: hit the slow endpoints N times,
record avg/min/max ms, append a row to results.tsv.

Usage:
    python measure.py conny-gfrerer
    python measure.py conny-gfrerer --runs 5 --note "after indexes"

Results are appended to results.tsv in the same directory.
"""

import argparse
import csv
import os
import subprocess
import sys
import time
from datetime import datetime

try:
    import httpx
except ImportError:
    print("httpx not found — installing...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "httpx", "-q"])
    import httpx

API_BASE = os.environ.get("CONTENT_API_URL", "http://127.0.0.1:8787")
API_KEY = os.environ.get("TEST_ACCOUNT_API_KEY", "")

RESULTS_TSV = os.path.join(os.path.dirname(__file__), "results.tsv")

ENDPOINTS = [
    ("activity",      "/api/v1/clients/{slug}/activity"),
    ("reels_metrics", "/api/v1/clients/{slug}/reels/metrics"),
    ("competitors",   "/api/v1/clients/{slug}/competitors"),
    ("reels_list",    "/api/v1/clients/{slug}/reels?include_analysis=false"),
]


def _git_hash() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=os.path.dirname(__file__),
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except Exception:
        return "unknown"


def _load_env() -> None:
    """Load .env from repo root if present."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


def measure_endpoint(client: httpx.Client, url: str, runs: int) -> dict:
    times_ms = []
    for i in range(runs):
        start = time.perf_counter()
        try:
            resp = client.get(url, timeout=30.0)
            elapsed_ms = (time.perf_counter() - start) * 1000
            status = resp.status_code
        except Exception as e:
            elapsed_ms = 30_000
            status = 0
            print(f"    run {i+1}: ERROR — {e}")
            continue
        times_ms.append(elapsed_ms)
        print(f"    run {i+1}: {elapsed_ms:.0f}ms  [HTTP {status}]")
        # Small gap between runs so we don't hammer the API
        time.sleep(0.3)

    if not times_ms:
        return {"avg": None, "min": None, "max": None, "runs": 0}
    return {
        "avg": round(sum(times_ms) / len(times_ms)),
        "min": round(min(times_ms)),
        "max": round(max(times_ms)),
        "runs": len(times_ms),
    }


def ensure_tsv_header() -> None:
    if not os.path.exists(RESULTS_TSV):
        with open(RESULTS_TSV, "w", newline="") as f:
            writer = csv.writer(f, delimiter="\t")
            writer.writerow(["timestamp", "commit", "endpoint", "avg_ms", "min_ms", "max_ms", "runs", "status", "note"])


def append_result(commit: str, endpoint: str, stats: dict, status: str, note: str) -> None:
    with open(RESULTS_TSV, "a", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow([
            datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            commit,
            endpoint,
            stats.get("avg", ""),
            stats.get("min", ""),
            stats.get("max", ""),
            stats.get("runs", ""),
            status,
            note,
        ])


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure silas dashboard endpoint performance")
    parser.add_argument("slug", help="Client slug, e.g. conny-gfrerer")
    parser.add_argument("--runs", type=int, default=3, help="Requests per endpoint (default: 3)")
    parser.add_argument("--note", default="", help="Description for this measurement run")
    parser.add_argument("--status", default="measure", help="Status tag: baseline / keep / discard / measure")
    parser.add_argument("--endpoints", nargs="*", help="Subset of endpoint names to run (default: all)")
    args = parser.parse_args()

    _load_env()
    api_key = os.environ.get("TEST_ACCOUNT_API_KEY", API_KEY)
    api_base = os.environ.get("CONTENT_API_URL", API_BASE)

    if not api_key:
        print("WARNING: TEST_ACCOUNT_API_KEY not set — requests may be unauthorized")

    org_slug = os.environ.get("TEST_ORG_SLUG", "test")
    headers = {"X-Org-Slug": org_slug}
    if api_key:
        headers["X-Api-Key"] = api_key

    commit = _git_hash()
    ensure_tsv_header()

    endpoints_to_run = [
        (name, path) for name, path in ENDPOINTS
        if not args.endpoints or name in args.endpoints
    ]

    print(f"\n{'='*60}")
    print(f"silas-content-system — performance measurement")
    print(f"  slug:    {args.slug}")
    print(f"  commit:  {commit}")
    print(f"  runs:    {args.runs} per endpoint")
    print(f"  note:    {args.note or '(none)'}")
    print(f"  api:     {api_base}")
    print(f"{'='*60}\n")

    results = {}
    with httpx.Client(headers=headers, base_url=api_base) as client:
        for name, path_template in endpoints_to_run:
            url = path_template.replace("{slug}", args.slug)
            print(f"[{name}] {url}")
            stats = measure_endpoint(client, url, args.runs)
            results[name] = stats
            if stats["avg"] is not None:
                print(f"  → avg: {stats['avg']}ms  min: {stats['min']}ms  max: {stats['max']}ms\n")
            append_result(commit, name, stats, args.status, args.note)

    print(f"\n{'='*60}")
    print(f"SUMMARY  (commit: {commit})")
    print(f"{'='*60}")
    print(f"{'endpoint':<20} {'avg_ms':>8} {'min_ms':>8} {'max_ms':>8}")
    print(f"{'-'*48}")
    for name, stats in results.items():
        if stats["avg"] is not None:
            print(f"{name:<20} {stats['avg']:>8} {stats['min']:>8} {stats['max']:>8}")
        else:
            print(f"{name:<20} {'FAILED':>8}")
    print(f"\nResults appended to: {RESULTS_TSV}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
