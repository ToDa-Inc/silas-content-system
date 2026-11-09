"""Learning loop → generation: what this client's own results and votes say, as one prompt block.

Built once per generation request and attached to the client row as ``_learning``; the prompt
packer prints it, and the generation routes store ``trace`` on the session ("Learned from …").

Limits keep the block focused: 5 winners, 5 to avoid, 5 weak hooks, 5 weak CTAs (last 90 days),
the latest 15 up- and 15 down-voted hooks/angles. Excluded reels are never used.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from services.post_reel_linking import own_reels_query

logger = logging.getLogger(__name__)

LOOKBACK_DAYS = 90
MAX_PER_BUCKET = 5
MAX_VOTES_PER_SIDE = 15


def _hook_line(reel: Dict[str, Any]) -> str:
    hook = str(reel.get("hook_text") or "").strip()
    if hook:
        return hook[:200]
    for line in str(reel.get("caption") or "").splitlines():
        if line.strip():
            return line.strip()[:200]
    return ""


def _numbers(m: Dict[str, Any]) -> str:
    """Exact ratios for the model (the UI shows plain sentences instead)."""
    parts = []
    if m.get("views_x") is not None:
        parts.append(f"views {m['views_x']}× her median")
    if m.get("comment_rate_x") is not None:
        parts.append(f"comments/view {m['comment_rate_x']}×")
    if m.get("engagement_rate_x") is not None:
        parts.append(f"engagement/view {m['engagement_rate_x']}×")
    return ", ".join(parts)


def _cta_line(caption: Optional[str]) -> str:
    """Last caption line that is not just hashtags — where her CTA usually sits."""
    for line in reversed(str(caption or "").splitlines()):
        t = line.strip()
        if t and not all(w.startswith("#") for w in t.split()):
            return t[:200]
    return ""


def build_learning_context(supabase, client_id: str, *, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """None when the client switched learning off. Empty lists when there is no data yet."""
    now = now or datetime.now(timezone.utc)
    crow = (
        supabase.table("clients")
        .select("instagram_handle,learning_enabled")
        .eq("id", client_id)
        .limit(1)
        .execute()
    ).data
    if not crow or crow[0].get("learning_enabled") is False:
        return None
    handle = crow[0].get("instagram_handle")

    # Reels in the lookback window first (bounded), then only their diagnostics.
    reels: Dict[str, Dict[str, Any]] = {
        str(r["id"]): r
        for r in (
            own_reels_query(supabase, client_id, handle, columns="id,post_url,posted_at,caption,hook_text,format,views")
            .gte("posted_at", (now - timedelta(days=LOOKBACK_DAYS)).isoformat())
            .order("posted_at", desc=True)
            .limit(200)
            .execute()
        ).data
        or []
    }
    by_reel: Dict[str, Dict[str, Any]] = {}
    if reels:
        for d in (
            supabase.table("reel_diagnostics")
            .select("reel_id,rule_bucket,override_bucket,excluded,reason,metrics")
            .eq("client_id", client_id)
            .eq("excluded", False)
            .in_("reel_id", list(reels.keys()))
            .execute()
        ).data or []:
            by_reel[str(d["reel_id"])] = d
    reels = {rid: r for rid, r in reels.items() if rid in by_reel}

    grouped: Dict[str, List[Dict[str, Any]]] = {"scale": [], "retire": [], "adjust_hook": [], "adjust_cta": []}
    for rid, r in reels.items():
        d = by_reel[rid]
        bucket = d.get("override_bucket") or d["rule_bucket"]
        if bucket in grouped:
            vx = float((d.get("metrics") or {}).get("views_x") or 0)
            grouped[bucket].append({"reel": r, "diag": d, "views_x": vx})
    grouped["scale"].sort(key=lambda x: -x["views_x"])
    for k in ("retire", "adjust_hook", "adjust_cta"):
        grouped[k].sort(key=lambda x: x["views_x"])

    def item(x: Dict[str, Any], *, with_cta: bool = False) -> Dict[str, Any]:
        r = x["reel"]
        out = {
            "reel_id": r["id"],
            "post_url": r.get("post_url"),
            "hook": _hook_line(r),
            "format": r.get("format"),
            "reason": _numbers(x["diag"].get("metrics") or {}),
        }
        if with_cta:
            out["cta"] = _cta_line(r.get("caption"))
        return out

    votes = (
        supabase.table("hook_votes")
        .select("kind,text,vote,updated_at")
        .eq("client_id", client_id)
        .order("updated_at", desc=True)
        .limit(200)
        .execute()
    ).data or []
    liked = [{"kind": v["kind"], "text": v["text"]} for v in votes if v["vote"] > 0][:MAX_VOTES_PER_SIDE]
    rejected = [{"kind": v["kind"], "text": v["text"]} for v in votes if v["vote"] < 0][:MAX_VOTES_PER_SIDE]

    ctx = {
        "winners": [item(x) for x in grouped["scale"][:MAX_PER_BUCKET]],
        "avoid": [item(x) for x in grouped["retire"][:MAX_PER_BUCKET]],
        "weak_hooks": [item(x) for x in grouped["adjust_hook"][:MAX_PER_BUCKET]],
        "weak_ctas": [item(x, with_cta=True) for x in grouped["adjust_cta"][:MAX_PER_BUCKET]],
        "liked": liked,
        "rejected": rejected,
    }
    plain = {rid: str(by_reel[rid].get("reason") or "") for rid in by_reel}
    ctx["trace"] = {
        "winners": [{"reel_id": i["reel_id"], "post_url": i["post_url"], "hook": i["hook"], "reason": plain.get(str(i["reel_id"]), "")} for i in ctx["winners"]],
        "avoid": [{"reel_id": i["reel_id"], "post_url": i["post_url"], "hook": i["hook"], "reason": plain.get(str(i["reel_id"]), "")} for i in ctx["avoid"]],
        "weak_hooks": len(ctx["weak_hooks"]),
        "weak_ctas": len(ctx["weak_ctas"]),
        "liked": len(liked),
        "rejected": len(rejected),
        "built_at": now.isoformat(),
    }
    return ctx


def has_learning(ctx: Optional[Dict[str, Any]]) -> bool:
    return bool(ctx) and any(ctx.get(k) for k in ("winners", "avoid", "weak_hooks", "weak_ctas", "liked", "rejected"))


def format_learning_block(ctx: Optional[Dict[str, Any]]) -> str:
    """Prompt block. Empty string when there is nothing to learn from."""
    if not has_learning(ctx):
        return ""
    assert ctx is not None
    lines = [
        "\n=== LEARNING (this client's own results + approved/rejected ideas) ===",
        "Evidence of what works for THIS audience. Use the patterns (hook mechanics, angle, structure, CTA style); "
        "never copy lines word for word.",
    ]

    def block(title: str, rows: List[str]) -> None:
        if rows:
            lines.append(f"\n{title}:")
            lines.extend(f"- {r}" for r in rows)

    block("WINNERS (do more of this)", [f"{w['hook']} [{w['format'] or 'reel'} · {w['reason']}]" for w in ctx["winners"]])
    block("HOOKS_THAT_DID_NOT_STOP_THE_SCROLL (avoid this hook style)", [f"{w['hook']} [{w['reason']}]" for w in ctx["weak_hooks"]])
    block("CTAS_THAT_UNDERPERFORMED (watched, few comments — write stronger CTAs)", [f"{w['cta']} [{w['reason']}]" for w in ctx["weak_ctas"] if w.get("cta")])
    block("AVOID (low reach and low engagement)", [f"{w['hook']} [{w['reason']}]" for w in ctx["avoid"]])
    block("LIKED_BY_THE_TEAM", [f"{v['kind']}: {v['text']}" for v in ctx["liked"]])
    block("REJECTED_BY_THE_TEAM (do not produce similar)", [f"{v['kind']}: {v['text']}" for v in ctx["rejected"]])
    return "\n".join(lines)
