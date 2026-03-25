"""
Prefixed opaque IDs (same pattern as Signalcore): prefix + url-safe base64(secrets.token_bytes(n)).

Use these for all app-owned primary keys. Auth-linked columns (profiles.id, organization_members.user_id)
stay UUID because they reference auth.users.
"""

from __future__ import annotations

import base64
import secrets


def generate_key(length: int = 8, *, prefix: str = "") -> str:
    """Random bytes → base64url without padding, optional prefix (e.g. org_)."""
    raw = secrets.token_bytes(length)
    key = base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")
    return f"{prefix}{key}"


def generate_org_id() -> str:
    return generate_key(8, prefix="org_")


def generate_client_id() -> str:
    return generate_key(8, prefix="cli_")


def generate_member_id() -> str:
    return generate_key(8, prefix="mbr_")


def generate_job_id() -> str:
    return generate_key(8, prefix="job_")


def generate_competitor_id() -> str:
    return generate_key(8, prefix="cmp_")


def generate_reel_id() -> str:
    return generate_key(8, prefix="srl_")


def generate_baseline_id() -> str:
    return generate_key(8, prefix="cbl_")
