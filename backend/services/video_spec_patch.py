"""Apply RFC 6902 JSON Patch to VideoSpec and validate."""

from __future__ import annotations

from typing import Any, Dict, List

import jsonpatch
from pydantic import ValidationError

from models.video_spec import VideoSpecV1, validate_video_spec_dict
from services.video_spec_timeline import normalize_timeline_after_patch

_APPEARANCE_PATCH_KEYS = (
    "fontId",
    "cardTextColor",
    "overlayTextColor",
    "cardBg",
    "overlayStroke",
)


def _expand_appearance_for_patch(raw: Any) -> Dict[str, Any]:
    """RFC 6902 ``replace`` requires leaf keys to exist. Studio sends ``replace`` on e.g.
    ``/blocks/0/appearance/fontId``; merge optional appearance dict over null placeholders."""
    base: Dict[str, Any] = {k: None for k in _APPEARANCE_PATCH_KEYS}
    if isinstance(raw, dict):
        for k in _APPEARANCE_PATCH_KEYS:
            if k in raw:
                base[k] = raw[k]
    return base


def _normalize_blocks_for_patch(blocks: Any) -> None:
    if not isinstance(blocks, list):
        return
    for b in blocks:
        if not isinstance(b, dict):
            continue
        b.setdefault("textTreatment", None)
        app = b.get("appearance")
        if app is None or not isinstance(app, dict):
            b["appearance"] = _expand_appearance_for_patch(None)
        else:
            b["appearance"] = _expand_appearance_for_patch(app)


def _validate_spec_dict(doc: Dict[str, Any]) -> VideoSpecV1:
    try:
        return validate_video_spec_dict(doc)
    except ValidationError as e:
        raise ValueError(f"invalid video spec after patch: {e}") from e


def _document_for_json_patch(model_dump: Dict[str, Any]) -> Dict[str, Any]:
    """Plain dict suitable for ``jsonpatch.JsonPatch.apply``.

    RFC 6902 ``replace`` requires the target member to exist on a mapping.
    ``model_dump(..., exclude_defaults=True)`` omits optional fields equal to
    their default (e.g. ``pausesSec`` is ``None``). Stored ``video_spec`` blobs
    may also omit optional keys. Without this, ``replace /pausesSec`` raises
    ``can't replace a non-existent object 'pausesSec'``.
    """
    doc = dict(model_dump)
    doc.setdefault("pausesSec", None)
    doc.setdefault("appearance", {})
    doc.setdefault("textTreatment", None)
    doc["appearance"] = _expand_appearance_for_patch(doc.get("appearance"))
    bl = doc.get("blocks")
    if isinstance(bl, list):
        _normalize_blocks_for_patch(bl)
    return doc


def _coerce_pauses_sec_ops(ops: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """RFC 6902 ``add`` fails if ``/pausesSec`` already exists. After
    :func:`_document_for_json_patch` the key is always present, so normalize any
    legacy ``add`` on that path to ``replace``."""
    out: List[Dict[str, Any]] = []
    for raw in ops:
        if not isinstance(raw, dict):
            out.append(raw)
            continue
        op = dict(raw)
        if op.get("path") == "/pausesSec" and op.get("op") == "add":
            op["op"] = "replace"
        out.append(op)
    return out


def _ops_preserve_explicit_layer_timing(ops: List[Dict[str, Any]]) -> bool:
    """When True, skip ``normalize_timeline_after_patch``.

    Relayout repacks ``blocks[*].startSec``/``endSec`` from pauses + clip cap. That is
    correct after pause/gap/total/hook-duration edits, but **wrong** for look-only patches
    (``/layout/*``, ``/themeId``, …): those must not erase hand-dragged layer windows.

    If the batch already includes explicit ``/blocks/N/startSec|endSec`` plus derived
    ``/pausesSec`` (layer editor), skip relayout — the document is already coherent.
    """
    if not isinstance(ops, list) or not ops:
        return True
    paths = [str(o.get("path") or "") for o in ops if isinstance(o, dict)]
    if not paths:
        return True

    timeline_drivers = (
        "/pausesSec",
        "/gapBetweenBlocksSec",
        "/totalSec",
        "/background/durationSec",
        "/background/trimStartSec",
        "/background/trimEndSec",
        "/hook/durationSec",
    )
    if any(p in timeline_drivers for p in paths):
        explicit_edges = any(
            p.startswith("/blocks/") and ("/startSec" in p or "/endSec" in p) for p in paths
        )
        # Any explicit layer window edit must not run ``normalize_timeline_after_patch`` — that
        # repacks beats from pauses/gaps. The UI often PATCHes ``startSec``/``endSec`` together
        # with ``totalSec`` (clip cap) without resending ``pausesSec``.
        if explicit_edges:
            return True
        # Hook trim/extend: studio sends ``/hook/durationSec`` + recomputed ``/pausesSec`` from
        # current absolute block windows — must not relayout or every text block jumps.
        if "/hook/durationSec" in paths and "/pausesSec" in paths:
            return True
        return False

    return any(
        p == "/blocks"
        or p.startswith("/blocks/")
        or p.startswith("/layout")
        or p in ("/hook/durationSec", "/hook/text")
        or p.startswith("/appearance")
        or p in ("/textTreatment", "/themeId", "/templateId", "/framing")
        or p.startswith("/brand/")
        or (p.startswith("/background/") and p != "/background/durationSec")
        for p in paths
    )


def apply_ops_to_spec(spec_dict: Dict[str, Any], ops: List[Dict[str, Any]]) -> VideoSpecV1:
    # Normalize through Pydantic first so default fields (e.g. `layout`) are present
    # on the dict we patch — otherwise `replace /layout/scale` on a pre-layout spec
    # would raise JsonPatchException("path does not exist").
    dumped = _validate_spec_dict(dict(spec_dict)).model_dump(mode="json")
    base = _document_for_json_patch(dumped)
    if not isinstance(ops, list) or not ops:
        return _validate_spec_dict(base)
    ops = _coerce_pauses_sec_ops(ops)
    patch = jsonpatch.JsonPatch(ops)
    try:
        new_doc = patch.apply(base)
    except jsonpatch.JsonPatchException as e:
        raise ValueError(f"invalid JSON Patch: {e}") from e
    if not isinstance(new_doc, dict):
        raise ValueError("patch result must be an object")
    if _ops_preserve_explicit_layer_timing(ops):
        return _validate_spec_dict(new_doc)
    new_doc = normalize_timeline_after_patch(new_doc)
    return _validate_spec_dict(new_doc)
