"""Pydantic models for VideoSpec v1 (Remotion + API)."""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

VideoTemplateId = Literal["bottom-card", "centered-pop", "top-banner", "capcut-highlight", "stacked-cards"]
VideoThemeId = Literal["bold-modern", "editorial", "casual-hand", "clean-minimal"]
VideoTextTreatmentId = Literal["bold-outline"]
AppearanceFontId = Literal["poppins", "inter", "playfair", "patrick"]
VideoAnimation = Literal["pop", "fade", "slide-up", "none"]
BackgroundKind = Literal["video", "image"]
FocalPoint = Literal["top", "center", "bottom"]
VerticalAnchor = Literal["bottom", "center", "top"]
TextAlign = Literal["left", "center", "right"]
# stacked-cards: ``up`` = stack hugs bottom safe area (new beats push earlier lines up).
# ``down`` = first line stays near the top band; new beats append below (no upward jump).
StackGrowth = Literal["up", "down"]

FONT_SCALE_MIN = 0.5
FONT_SCALE_MAX = 2.0
COMPOSITION_FPS = 30


def _sec_to_frame(sec: float) -> int:
    return max(0, round(float(sec) * COMPOSITION_FPS))


def frame_to_sec(frames: int) -> float:
    return max(0, int(frames)) / float(COMPOSITION_FPS)


def _coerce_font_scale(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return max(FONT_SCALE_MIN, min(FONT_SCALE_MAX, x))


def playable_background_frames(bg: "VideoSpecBackground") -> Optional[int]:
    """Playable frame count at 30fps after trim — authoritative for composition length."""
    if bg.kind != "video":
        return None
    if bg.durationFrames is not None and bg.durationFrames > 0:
        source_frames = int(bg.durationFrames)
    elif bg.durationSec is not None and bg.durationSec > 0:
        source_frames = max(1, round(float(bg.durationSec) * COMPOSITION_FPS))
    else:
        return None
    start_f = min(_sec_to_frame(float(bg.trimStartSec or 0)), source_frames - 1)
    if bg.trimEndSec is not None:
        end_f = min(_sec_to_frame(float(bg.trimEndSec)), source_frames)
    else:
        end_f = source_frames
    end_f = max(start_f + 1, min(end_f, source_frames))
    return max(1, end_f - start_f)


def effective_background_duration(bg: "VideoSpecBackground") -> Optional[float]:
    """Playable B-roll window for timeline caps — not the raw asset length."""
    frames = playable_background_frames(bg)
    if frames is not None:
        return frame_to_sec(frames)
    if bg.kind != "video" or bg.durationSec is None:
        return None
    source = float(bg.durationSec)
    if source <= 0:
        return None
    start = max(0.0, float(bg.trimStartSec or 0))
    end = float(bg.trimEndSec) if bg.trimEndSec is not None else source
    end = min(max(start + 0.05, end), source)
    start = min(start, end - 0.05)
    eff = end - start
    return eff if eff > 0 else None


class VideoSpecBrand(BaseModel):
    model_config = ConfigDict(extra="ignore")

    primary: str = Field(default="#ffffff", max_length=32)
    accent: Optional[str] = Field(default=None, max_length=32)


class VideoSpecBackground(BaseModel):
    model_config = ConfigDict(extra="ignore")

    url: str = Field(..., min_length=1, max_length=4096)
    kind: BackgroundKind = "image"
    focalPoint: FocalPoint = "center"
    """When ``kind`` is ``video`` (B-roll), set from ``broll_clips`` so the timeline
    matches the clip. ``durationFrames`` is authoritative for export frame count."""
    durationSec: Optional[float] = None
    durationFrames: Optional[int] = None
    """In-point on the source file (seconds). Out-point is ``trimEndSec`` or full ``durationSec``."""
    trimStartSec: float = Field(default=0.0, ge=0.0, le=600.0)
    trimEndSec: Optional[float] = Field(default=None)

    @field_validator("durationFrames", mode="before")
    @classmethod
    def _duration_frames(cls, v: Any) -> Optional[int]:
        if v is None or v == "":
            return None
        try:
            n = int(v)
        except (TypeError, ValueError):
            return None
        if n <= 0 or n > 18000:
            return None
        return n

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

    @field_validator("trimEndSec", mode="before")
    @classmethod
    def _trim_end_sec(cls, v: Any) -> Optional[float]:
        if v is None or v == "":
            return None
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        if x <= 0 or x > 600:
            return None
        return x

    @model_validator(mode="after")
    def _normalize_trim(self) -> "VideoSpecBackground":
        start = max(0.0, float(self.trimStartSec or 0))
        source = float(self.durationSec) if self.durationSec is not None else None
        end = float(self.trimEndSec) if self.trimEndSec is not None else source
        if source is not None and source > 0:
            end = source if end is None else min(end, source)
            if end is not None and end <= start:
                end = min(source, start + 0.5)
            start = min(start, max(0.0, (end or source) - 0.05))
        return self.model_copy(update={"trimStartSec": start, "trimEndSec": end})


class VideoSpecHook(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str = Field("", max_length=500)
    durationSec: float = Field(default=3.0, ge=0.05, le=600.0)
    """Per-hook size multiplier on top of global ``layout.scale``; ``None`` = 1.0."""
    fontScale: Optional[float] = None

    @field_validator("fontScale", mode="before")
    @classmethod
    def _hook_font_scale(cls, v: Any) -> Optional[float]:
        return _coerce_font_scale(v)


class VideoSpecBlock(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=64)
    text: str = Field("", max_length=500)
    isCTA: bool = False
    startSec: float = Field(ge=0.0)
    endSec: float = Field(gt=0.0)
    animation: VideoAnimation = "fade"
    """Optional look overrides for this beat only (inherits from top-level ``appearance``)."""
    appearance: Optional["VideoSpecAppearance"] = None
    """Optional lettering treatment for this beat (inherits from top-level ``textTreatment``)."""
    textTreatment: Optional[VideoTextTreatmentId] = None
    """Per-beat size multiplier on top of global ``layout.scale``; ``None`` = 1.0."""
    fontScale: Optional[float] = None

    @field_validator("fontScale", mode="before")
    @classmethod
    def _block_font_scale(cls, v: Any) -> Optional[float]:
        return _coerce_font_scale(v)

    @model_validator(mode="after")
    def _order(self) -> "VideoSpecBlock":
        if self.endSec <= self.startSec:
            raise ValueError("block endSec must be greater than startSec")
        return self


class VideoSpecLayout(BaseModel):
    """Global layout modifiers applied uniformly across the chosen template.

    Kept intentionally small so the spec stays AI-authorable and deterministic.
    Per-block free positioning is deliberately *not* exposed — use template +
    anchor + alignment + stack gap instead.
    """

    model_config = ConfigDict(extra="ignore")

    # Where the text stack anchors on the canvas (bottom-card, stacked-cards).
    verticalAnchor: VerticalAnchor = Field(default="bottom")
    # Fine nudge as a fraction of canvas height. Negative = up, positive = down.
    # Full frame in each direction (±1.0 = ±100%) so editors can align with face-cam / UI.
    verticalOffset: float = Field(default=0.0, ge=-1.0, le=1.0)

    @field_validator("verticalAnchor", mode="before")
    @classmethod
    def _coerce_vertical_anchor(cls, v: Any) -> str:
        s = str(v).strip().lower() if v is not None else "bottom"
        return s if s in ("bottom", "center", "top") else "bottom"

    @field_validator("verticalOffset", mode="before")
    @classmethod
    def _coerce_vertical_offset(cls, v: Any) -> float:
        """Clamp to the supported nudge range (legacy ±0.2 specs still load fine)."""
        try:
            x = float(v)
        except (TypeError, ValueError):
            return 0.0
        return max(-1.0, min(1.0, x))

    # Multiplier on the template's default fontSize (and card padding scales with it visually).
    scale: float = Field(default=1.0, ge=0.7, le=1.3)
    # Per-side horizontal padding as a fraction of canvas width (0.05 = 54px on 1080).
    sidePadding: float = Field(default=0.05, ge=0.02, le=0.12)
    # Caption line alignment inside the text area (all templates).
    textAlign: TextAlign = Field(default="center")
    # Vertical gap between stacked caption cards, as a fraction of canvas height
    # (e.g. 0.01 ≈ 19px on 1920px). Used by ``stacked-cards`` only.
    stackGap: float = Field(default=0.008, ge=0.0, le=0.06)
    # stacked-cards only: how the vertical list grows as beats appear (see StackGrowth).
    stackGrowth: StackGrowth = Field(default="up")
    # Horizontal pan of the caption block as a fraction of canvas width (-1..1).
    textPanX: float = Field(default=0.0, ge=-1.0, le=1.0)

    @field_validator("textPanX", mode="before")
    @classmethod
    def _coerce_text_pan_x(cls, v: Any) -> float:
        try:
            x = float(v)
        except (TypeError, ValueError):
            return 0.0
        return max(-1.0, min(1.0, x))

    @field_validator("textAlign", mode="before")
    @classmethod
    def _coerce_text_align(cls, v: Any) -> str:
        s = str(v).strip().lower() if v is not None else "center"
        return s if s in ("left", "center", "right") else "center"

    @field_validator("stackGap", mode="before")
    @classmethod
    def _coerce_stack_gap(cls, v: Any) -> float:
        try:
            x = float(v)
        except (TypeError, ValueError):
            return 0.008
        return max(0.0, min(0.06, x))

    @field_validator("stackGrowth", mode="before")
    @classmethod
    def _coerce_stack_growth(cls, v: Any) -> str:
        s = str(v).strip().lower() if v is not None else "up"
        return s if s in ("up", "down") else "up"


class VideoSpecAppearance(BaseModel):
    """Optional overrides on top of ``themeId`` presets (font + colors).

    ``None`` / omitted fields mean “use the active look (theme) default”.
    """

    model_config = ConfigDict(extra="ignore")

    fontId: Optional[AppearanceFontId] = None
    cardTextColor: Optional[str] = Field(default=None, max_length=40)
    overlayTextColor: Optional[str] = Field(default=None, max_length=40)
    cardBg: Optional[str] = Field(default=None, max_length=40)
    overlayStroke: Optional[str] = Field(default=None, max_length=40)

    @field_validator("fontId", mode="before")
    @classmethod
    def _font_id(cls, v: Any) -> Optional[str]:
        if v is None or v == "":
            return None
        s = str(v).strip().lower()
        return s if s in ("poppins", "inter", "playfair", "patrick") else None

    @field_validator("cardTextColor", "overlayTextColor", "cardBg", "overlayStroke", mode="before")
    @classmethod
    def _colorish(cls, v: Any) -> Optional[str]:
        if v is None or v == "":
            return None
        s = str(v).strip()
        if not s or len(s) > 40:
            return None
        return s


class VideoSpecV1(BaseModel):
    """Top-level props for Remotion composition `video-spec`."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    v: Literal[1] = 1
    templateId: VideoTemplateId = "centered-pop"
    themeId: VideoThemeId = "bold-modern"
    """Heavy outer-stroke caption style; composes with any ``templateId`` (legacy ``capcut-highlight`` maps here)."""
    textTreatment: Optional[VideoTextTreatmentId] = None
    appearance: VideoSpecAppearance = Field(default_factory=VideoSpecAppearance)
    brand: VideoSpecBrand = Field(default_factory=VideoSpecBrand)
    background: VideoSpecBackground
    hook: VideoSpecHook = Field(default_factory=VideoSpecHook)
    blocks: List[VideoSpecBlock] = Field(default_factory=list)
    # Existing rows in DB never had this field; default_factory backfills them on parse.
    layout: VideoSpecLayout = Field(default_factory=VideoSpecLayout)
    totalSec: float = Field(default=12.0, ge=2.0, le=600.0)
    # Per-pause / legacy gap cap. The real ceiling is ``totalSec`` ≤ 600; 5s
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
    def _migrate_legacy_capcut(self) -> "VideoSpecV1":
        """``capcut-highlight`` was a separate template; it is now ``textTreatment`` + ``centered-pop``."""
        if self.templateId != "capcut-highlight":
            return self
        return self.model_copy(
            update={"templateId": "centered-pop", "textTreatment": "bold-outline"}
        )

    @model_validator(mode="after")
    def _sorted_and_total(self) -> "VideoSpecV1":
        cap: Optional[float] = None
        if self.background.kind == "video":
            eff = effective_background_duration(self.background)
            if eff is not None and eff > 0:
                cap = eff
        hook = self.hook
        if cap is not None and hook.durationSec > cap:
            hook = hook.model_copy(update={"durationSec": max(0.05, cap)})
        blocks = sorted(self.blocks, key=lambda b: b.startSec)
        if cap is not None:
            capped_blocks: List[VideoSpecBlock] = []
            for b in blocks:
                start = min(float(b.startSec), float(cap))
                end = min(float(b.endSec), float(cap))
                if end <= start:
                    start = max(0.0, end - 0.05)
                capped_blocks.append(b.model_copy(update={"startSec": start, "endSec": end}))
            blocks = capped_blocks
        for b in blocks:
            if b.startSec < 0:
                raise ValueError("block startSec must be >= 0")
        max_end = max((b.endSec for b in blocks), default=0.0)
        min_total = max(max_end, hook.durationSec + 0.5)
        # Align with ``relayout_spec``: when B-roll length is known, composition
        # length is min(content end, clip) — never keep a stale ``totalSec``
        # above the clip after blocks were fitted.
        pf = playable_background_frames(self.background)
        if pf is not None:
            new_total = frame_to_sec(pf)
        elif cap is None:
            new_total = max(float(self.totalSec), min_total)
        else:
            new_total = min(min_total, float(cap))
        return self.model_copy(update={"hook": hook, "blocks": blocks, "totalSec": new_total})

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
