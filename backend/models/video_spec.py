"""Pydantic models for VideoSpec v1 (Remotion + API)."""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

VideoTemplateId = Literal["bottom-card", "centered-pop", "top-banner", "capcut-highlight"]
VideoThemeId = Literal["bold-modern", "editorial", "casual-hand", "clean-minimal"]
VideoAnimation = Literal["pop", "fade", "slide-up", "none"]
BackgroundKind = Literal["video", "image"]
FocalPoint = Literal["top", "center", "bottom"]
VerticalAnchor = Literal["bottom", "center", "top"]


class VideoSpecBrand(BaseModel):
    model_config = ConfigDict(extra="ignore")

    primary: str = Field(default="#ffffff", max_length=32)
    accent: Optional[str] = Field(default=None, max_length=32)


class VideoSpecBackground(BaseModel):
    model_config = ConfigDict(extra="ignore")

    url: str = Field(..., min_length=1, max_length=4096)
    kind: BackgroundKind = "image"
    focalPoint: FocalPoint = "center"
    """When ``kind`` is ``video`` (B-roll), set from ``broll_clips.duration_s`` so
    ``totalSec`` matches the clip and the timeline is fitted to that cap."""
    durationSec: Optional[float] = None

    @field_validator("durationSec", mode="before")
    @classmethod
    def _duration_sec(cls, v: Any) -> Optional[float]:
        if v is None or v == "":
            return None
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        if x <= 0 or x > 600:
            raise ValueError("background.durationSec must be between 0 and 600")
        return x


class VideoSpecHook(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str = Field("", max_length=500)
    durationSec: float = Field(default=3.0, ge=1.0, le=30.0)


class VideoSpecBlock(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=64)
    text: str = Field("", max_length=500)
    isCTA: bool = False
    startSec: float = Field(ge=0.0)
    endSec: float = Field(gt=0.0)
    animation: VideoAnimation = "fade"

    @model_validator(mode="after")
    def _order(self) -> "VideoSpecBlock":
        if self.endSec <= self.startSec:
            raise ValueError("block endSec must be greater than startSec")
        return self


class VideoSpecLayout(BaseModel):
    """Global layout modifiers applied uniformly across the chosen template.

    Kept intentionally small (3 knobs) so the spec stays AI-authorable and
    deterministic. Per-block overrides are deliberately *not* exposed —
    rephrase via Refine-with-AI or change templates instead.
    """

    model_config = ConfigDict(extra="ignore")

    # Where the text stack anchors on the canvas (bottom-card reads this;
    # centered templates still use flex center + ``verticalOffset`` nudge).
    verticalAnchor: VerticalAnchor = Field(default="bottom")
    # Fine nudge as a fraction of canvas height. Negative = up, positive = down.
    # Tighter range once ``verticalAnchor`` handles coarse placement.
    verticalOffset: float = Field(default=0.0, ge=-0.2, le=0.2)

    @field_validator("verticalAnchor", mode="before")
    @classmethod
    def _coerce_vertical_anchor(cls, v: Any) -> str:
        s = str(v).strip().lower() if v is not None else "bottom"
        return s if s in ("bottom", "center", "top") else "bottom"

    @field_validator("verticalOffset", mode="before")
    @classmethod
    def _coerce_vertical_offset(cls, v: Any) -> float:
        """Clamp legacy specs that used the old wide offset range."""
        try:
            x = float(v)
        except (TypeError, ValueError):
            return 0.0
        return max(-0.2, min(0.2, x))
    # Multiplier on the template's default fontSize (and card padding scales with it visually).
    scale: float = Field(default=1.0, ge=0.7, le=1.3)
    # Per-side horizontal padding as a fraction of canvas width (0.05 = 54px on 1080).
    sidePadding: float = Field(default=0.05, ge=0.02, le=0.12)


class VideoSpecV1(BaseModel):
    """Top-level props for Remotion composition `video-spec`."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    v: Literal[1] = 1
    templateId: VideoTemplateId = "centered-pop"
    themeId: VideoThemeId = "bold-modern"
    brand: VideoSpecBrand = Field(default_factory=VideoSpecBrand)
    background: VideoSpecBackground
    hook: VideoSpecHook = Field(default_factory=VideoSpecHook)
    blocks: List[VideoSpecBlock] = Field(default_factory=list)
    # Existing rows in DB never had this field; default_factory backfills them on parse.
    layout: VideoSpecLayout = Field(default_factory=VideoSpecLayout)
    totalSec: float = Field(default=12.0, ge=2.0, le=120.0)
    # Per-pause / legacy gap cap. The real ceiling is ``totalSec`` ≤ 120; 5s
    # per gap is plenty for breathing room without being abusable.
    gapBetweenBlocksSec: float = Field(default=0.0, ge=0.0, le=5.0)
    """When set and len == len(blocks), pause before each block in sorted order (index 0 = after hook).

    If absent or wrong length, ``gapBetweenBlocksSec`` is repeated for every transition (legacy).
    """
    pausesSec: Optional[List[float]] = None

    @field_validator("pausesSec", mode="before")
    @classmethod
    def _pauses_sec(cls, v: Any) -> Optional[List[float]]:
        if v is None:
            return None
        if not isinstance(v, list):
            return None
        out: List[float] = []
        for x in v[:24]:
            try:
                xf = float(x)
            except (TypeError, ValueError):
                continue
            out.append(max(0.0, min(5.0, xf)))
        return out or None

    @field_validator("blocks", mode="before")
    @classmethod
    def _blocks_list(cls, v: Any) -> Any:
        if v is None:
            return []
        return v

    @model_validator(mode="after")
    def _sorted_and_total(self) -> "VideoSpecV1":
        blocks = sorted(self.blocks, key=lambda b: b.startSec)
        for b in blocks:
            if b.startSec < 0:
                raise ValueError("block startSec must be >= 0")
        max_end = max((b.endSec for b in blocks), default=0.0)
        min_total = max(max_end, self.hook.durationSec + 0.5)
        cap: Optional[float] = None
        if self.background.kind == "video" and self.background.durationSec is not None:
            c = float(self.background.durationSec)
            if c > 0:
                cap = c
        # Align with ``relayout_spec``: when B-roll length is known, composition
        # length is min(content end, clip) — never keep a stale ``totalSec``
        # above the clip after blocks were fitted.
        if cap is None:
            new_total = max(float(self.totalSec), min_total)
        else:
            new_total = min(min_total, float(cap))
        return self.model_copy(update={"blocks": blocks, "totalSec": new_total})

    def model_dump_for_remotion(self) -> Dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True)


def parse_video_spec(raw: Any) -> Optional[VideoSpecV1]:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return None
    try:
        return VideoSpecV1.model_validate(raw)
    except Exception:
        return None


def validate_video_spec_dict(data: Dict[str, Any]) -> VideoSpecV1:
    return VideoSpecV1.model_validate(data)
