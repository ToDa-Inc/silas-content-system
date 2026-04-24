#!/usr/bin/env python3
"""
measure.py — Performance harness for silas-content-system generate page endpoints.

Targets the exact endpoints fired on /generate page mount to baseline the
auth-chain waterfall described in perf-audit.md.

Usage:
    python measure.py --note "baseline"
    python measure.py --note "after: cache clientApiContext" --runs 7

Results are appended to results.tsv in the same directory (never overwritten).
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

# ── Config — derived from .env (org owner key, not test key which lacks org membership)
API_BASE  = "http://127.0.0.1:8787"
API_KEY   = "e7d67c159658f9cd9a9cca872598af14dd0357747e2f90c4"  # org owner profile
ORG_SLUG  = "test"
CLIENT    = "conny-gfrerer"

RESULTS_TSV = os.path.join(os.path.dirname(__file__), "results.tsv")

# The generate page fires these on every mount, in this order
ENDPOINTS = [
    # Fired in parallel (Promise.all) but each pays full auth cost independently
    ("generate_sessions",   f"/api/v1/clients/{CLIENT}/generate/sessions?limit=15",  "auth+data"),
    ("format_digests",      f"/api/v1/clients/{CLIENT}/generate/format-digests",      "auth+data"),
    # Fires after clientSlug/orgSlug state is set (cascaded effect — extra RTT)
    ("adapt_preview_reels", f"/api/v1/clients/{CLIENT}/reels/adapt-preview?limit=15", "auth+data"),
    # Source picker list (source step)
    ("reel_analyses",       f"/api/v1/clients/{CLIENT}/reel-analyses?limit=50",        "auth+data"),
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


def _git_hash() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=os.path.dirname(__file__),
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except Exception:
        return "unknown"


def measure_endpoint(client: httpx.Client, url: str, runs: int) -> dict:
    """
    Returns per-run timings split into cold (run 0) and warm (runs 1+).
    Cold = first hit, no in-process cache warmed. Warm = subsequent hits.
    """
    cold_ms = None
    warm_ms_list: list[float] = []

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

        label = "❄ cold" if i == 0 else "  warm"
        print(f"    {label} run {i+1}: {elapsed_ms:6.0f}ms  [HTTP {status}]")

        if i == 0:
            cold_ms = elapsed_ms
        else:
            warm_ms_list.append(elapsed_ms)

    warm_avg = round(sum(warm_ms_list) / len(warm_ms_list)) if warm_ms_list else None
    all_ms = ([cold_ms] if cold_ms is not None else []) + warm_ms_list
    return {
        "cold_ms":  round(cold_ms) if cold_ms is not None else None,
        "warm_avg": warm_avg,
        "avg":      round(sum(all_ms) / len(all_ms)) if all_ms else None,
        "min":      round(min(all_ms)) if all_ms else None,
        "max":      round(max(all_ms)) if all_ms else None,
        "runs":     len(all_ms),
    }


def ensure_tsv_header() -> None:
    if not os.path.exists(RESULTS_TSV):
        with open(RESULTS_TSV, "w", newline="") as f:
            writer = csv.writer(f, delimiter="\t")
            writer.writerow([
                "timestamp", "commit", "note", "endpoint", "category",
                "cold_ms", "warm_avg_ms", "avg_ms", "min_ms", "max_ms", "runs",
            ])


def append_result(commit: str, note: str, name: str, category: str, stats: dict) -> None:
    with open(RESULTS_TSV, "a", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow([
            datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            commit,
            note,
            name,
            category,
            stats.get("cold_ms", ""),
            stats.get("warm_avg", ""),
            stats.get("avg", ""),
            stats.get("min", ""),
            stats.get("max", ""),
            stats.get("runs", ""),
        ])


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure /generate page endpoint latency")
    parser.add_argument("--runs",  type=int, default=5, help="Requests per endpoint (default: 5)")
    parser.add_argument("--note",  default="",          help="Label for this measurement pass")
    args = parser.parse_args()

    headers = {
        "X-Api-Key":   API_KEY,
        "X-Org-Slug":  ORG_SLUG,
    }
    commit = _git_hash()
    ensure_tsv_header()

    print(f"\n{'='*62}")
    print(f"  generate-page perf audit  |  {args.runs} runs/endpoint")
    print(f"  commit: {commit}  |  note: {args.note or '(none)'}")
    print(f"  backend: {API_BASE}  |  client: {CLIENT}")
    print(f"{'='*62}\n")

    summary: list[tuple[str, dict]] = []

    with httpx.Client(headers=headers, base_url=API_BASE) as client:
        for name, path, category in ENDPOINTS:
            print(f"▸ [{category}] {name}")
            stats = measure_endpoint(client, path, args.runs)
            summary.append((name, stats))
            cold = stats["cold_ms"]
            warm = stats["warm_avg"]
            print(f"  → cold: {cold}ms  warm avg: {warm}ms\n")
            append_result(commit, args.note, name, category, stats)

    print(f"\n{'='*62}")
    print(f"SUMMARY  (commit: {commit}, note: {args.note or 'none'})")
    print(f"{'='*62}")
    print(f"{'endpoint':<28} {'cold_ms':>8} {'warm_avg':>9} {'avg_ms':>8}")
    print(f"{'-'*58}")
    for name, stats in summary:
        cold = str(stats["cold_ms"]) if stats["cold_ms"] is not None else "FAIL"
        warm = str(stats["warm_avg"]) if stats["warm_avg"] is not None else "  —"
        avg  = str(stats["avg"])      if stats["avg"]      is not None else "FAIL"
        print(f"{name:<28} {cold:>8} {warm:>9} {avg:>8}")
    print(f"\nResults appended → results.tsv")
    print(f"{'='*62}\n")


if __name__ == "__main__":
    main()
