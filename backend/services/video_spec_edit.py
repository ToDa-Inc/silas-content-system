"""LLM: natural-language instruction → JSON Patch ops for VideoSpec."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from services.openrouter import chat_json_completion

VIDEO_SPEC_PATCH_SYSTEM = """You output RFC 6902 JSON Patch operations for a VideoSpec v1 object.

The document has this shape (field names are camelCase):
- v: always 1
- templateId: "bottom-card" | "centered-pop" | "top-banner" | "capcut-highlight"
- themeId: "bold-modern" | "editorial" | "casual-hand" | "clean-minimal"
- brand: { primary: hex string, accent?: hex }
- background: { url, kind: "video"|"image", focalPoint: "top"|"center"|"bottom", durationSec?: number }
- hook: { text, durationSec }
- blocks: array of { id, text, isCTA, startSec, endSec, animation: "pop"|"fade"|"slide-up"|"none" }
- layout: { verticalAnchor: "bottom"|"center"|"top", verticalOffset: -0.2..0.2, scale: 0.7..1.3, sidePadding: 0.02..0.12 }
- gapBetweenBlocksSec: number 0..5 — legacy uniform pause; ignored when pausesSec matches blocks
- pausesSec: number[] same length as blocks — pause before each block in timeline order (index 0 after hook); prefer this for uneven pauses
- totalSec: number (must be >= max block endSec and >= hook.durationSec; equals background.durationSec when B-roll clip length is known)

LAYOUT GUIDE (for instructions about position / size / margins):
- "make text bigger / smaller" → replace /layout/scale (e.g. 1.15 / 0.85)
- "move text up / down" → replace /layout/verticalOffset (negative = up, positive = down) OR change /layout/verticalAnchor for bottom-card (center = true vertical center)
- "add more padding / breathing room" → replace /layout/sidePadding (e.g. 0.08–0.10)
- "center the text vertically" on bottom-card → replace /layout/verticalAnchor with "center" and /layout/verticalOffset with 0; on centered-pop → verticalOffset 0
- Use these BEFORE inventing new fields. Templates render layout.* uniformly.

RULES:
1. Return ONLY a JSON object: { "ops": [ ...patch ops... ], "summary": "one sentence" }
2. Each op is { "op": "add"|"remove"|"replace", "path": "/json/pointer", "value": ... } (value except for remove)
3. Prefer replace on /templateId, /themeId, /layout/*, /hook/durationSec, /blocks/N/text, /blocks/N/startSec, /blocks/N/endSec, /blocks/N/animation, /totalSec, /background/focalPoint, /gapBetweenBlocksSec
4. Never change background.url or v (unless user explicitly asks to change URL — usually do not)
5. Keep blocks sorted by startSec; do not create overlapping windows unless user asks
6. If instruction is vague, make the smallest reasonable visual change (e.g. theme, animation, timing)
7. ALWAYS return at least one op. If the request is impossible, pick the closest semantic interpretation and proceed — do NOT return an empty ops array.

No markdown fences. No commentary outside JSON."""


def propose_spec_patch(
    *,
    openrouter_key: str,
    model: str,
    current_spec: Dict[str, Any],
    instruction: str,
    language: str = "de",
) -> Tuple[List[Dict[str, Any]], str]:
    if not openrouter_key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")
    user = json.dumps(
        {
            "client_content_language": (language or "de").strip() or "de",
            "current_spec": current_spec,
            "instruction": instruction.strip(),
        },
        ensure_ascii=False,
    )
    data = chat_json_completion(
        openrouter_key,
        model,
        system=VIDEO_SPEC_PATCH_SYSTEM,
        user=user,
        max_tokens=4096,
        temperature=0.25,
    )
    ops = data.get("ops")
    if not isinstance(ops, list):
        raise RuntimeError("Model response missing ops array")
    out_ops: List[Dict[str, Any]] = []
    for item in ops:
        if isinstance(item, dict) and "op" in item and "path" in item:
            out_ops.append(dict(item))
    summary = str(data.get("summary") or "").strip() or "Updated video spec."
    return out_ops, summary


def propose_spec_patch_with_retry(
    *,
    openrouter_key: str,
    model: str,
    current_spec: Dict[str, Any],
    instruction: str,
    language: str = "de",
) -> Tuple[List[Dict[str, Any]], str]:
    try:
        return propose_spec_patch(
            openrouter_key=openrouter_key,
            model=model,
            current_spec=current_spec,
            instruction=instruction,
            language=language,
        )
    except Exception:
        return propose_spec_patch(
            openrouter_key=openrouter_key,
            model=model,
            current_spec=current_spec,
            instruction=instruction + "\n\nReturn ONLY valid JSON with an ops array.",
            language=language,
        )
