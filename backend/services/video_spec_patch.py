"""Apply RFC 6902 JSON Patch to VideoSpec and validate."""

from __future__ import annotations

from typing import Any, Dict, List

import jsonpatch

from models.video_spec import VideoSpecV1, validate_video_spec_dict
from services.video_spec_timeline import normalize_timeline_after_patch


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


def apply_ops_to_spec(spec_dict: Dict[str, Any], ops: List[Dict[str, Any]]) -> VideoSpecV1:
    # Normalize through Pydantic first so default fields (e.g. `layout`) are present
    # on the dict we patch — otherwise `replace /layout/scale` on a pre-layout spec
    # would raise JsonPatchException("path does not exist").
    dumped = validate_video_spec_dict(dict(spec_dict)).model_dump(mode="json")
    base = _document_for_json_patch(dumped)
    if not isinstance(ops, list) or not ops:
        return validate_video_spec_dict(base)
    ops = _coerce_pauses_sec_ops(ops)
    patch = jsonpatch.JsonPatch(ops)
    try:
        new_doc = patch.apply(base)
    except jsonpatch.JsonPatchException as e:
        raise ValueError(f"invalid JSON Patch: {e}") from e
    if not isinstance(new_doc, dict):
        raise ValueError("patch result must be an object")
    new_doc = normalize_timeline_after_patch(new_doc)
    return validate_video_spec_dict(new_doc)
