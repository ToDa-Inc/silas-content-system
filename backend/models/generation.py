from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from models.video_spec import VideoSpecAppearance, VideoSpecLayout, VideoTemplateId, VideoThemeId


class CarouselTextBox(BaseModel):
    """Normalized text frame for carousel composition (editor + export).

    ``x`` / ``y`` are the horizontal / vertical center of the text block (0–1).
    ``width`` is the fraction of canvas width used for wrapping.
    """

    model_config = ConfigDict(extra="ignore")

    x: float = Field(0.5, ge=0.0, le=1.0)
    y: float = Field(0.82, ge=0.0, le=1.0)
    width: float = Field(0.84, ge=0.25, le=1.0)
    align: Literal["left", "center", "right"] = "center"
    scale: float = Field(1.0, ge=0.4, le=2.0)
    card: bool = False
    font: Literal["playfair", "inter", "poppins", "georgia"] = "playfair"


class CarouselBackgroundStyle(BaseModel):
    """Visual treatment applied above the base image and below text."""

    model_config = ConfigDict(extra="ignore")

    overlay_color: str = Field("#ffffff", max_length=32)
    overlay_opacity: float = Field(0.0, ge=0.0, le=1.0)


class SelectedCta(BaseModel):
    """Snapshot of the CTA the user picked under the format selector.

    Stored on each ``generation_sessions`` row so old sessions stay stable even
    if the client later edits their CTA library in Settings.
    """

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=120)
    type: Literal[
        "website",
        "newsletter",
        "video",
        "lead_magnet",
        "booking",
        "other",
    ] = "other"
    destination: str = Field("", max_length=2048)
    traffic_goal: str = Field("", max_length=500)
    instructions: Optional[str] = Field(None, max_length=1000)


class SelectedCarouselTemplateSlide(BaseModel):
    """One slide in a snapshotted carousel template sequence.

    Reference images come from the client Media library and guide the generated
    slide visually; they are not reused as the final slide pixels.
    """

    model_config = ConfigDict(extra="ignore")

    idx: int = Field(..., ge=0, le=9)
    role: Literal["cover", "body", "screenshot", "quote", "cta", "other"] = "body"
    reference_image_id: Optional[str] = Field(None, max_length=64)
    reference_image_url: Optional[str] = Field(None, max_length=2048)
    reference_label: Optional[str] = Field(None, max_length=200)
    instruction: str = Field("", max_length=800)


class SelectedCarouselTemplate(BaseModel):
    """Snapshot of the carousel template picked before session generation."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=500)
    slides: List[SelectedCarouselTemplateSlide] = Field(..., min_length=1, max_length=10)


class SelectedCoverTemplate(BaseModel):
    """Snapshot of the cover/thumbnail template picked before generation."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=120)
    reference_image_id: str = Field(..., min_length=1, max_length=64)
    reference_image_url: Optional[str] = Field(None, max_length=2048)
    reference_label: Optional[str] = Field(None, max_length=200)
    instruction: str = Field("", max_length=800)


class GenerationStartBody(BaseModel):
    """POST …/generate/start"""

    source_type: Literal[
        "outlier",
        "patterns",
        "manual",
        "format_pick",
        "idea_match",
        "url_adapt",
        "script_adapt",
    ] = "patterns"
    source_analysis_ids: Optional[List[str]] = Field(
        None,
        description="reel_analyses.id (uuid as string). Required when source_type=outlier.",
    )
    max_analyses: int = Field(12, ge=3, le=20, description="How many analyses to pull for patterns/manual.")
    extra_instruction: Optional[str] = Field(
        None,
        max_length=2000,
        description="Optional focus for manual mode.",
    )
    format_key: Optional[str] = Field(
        None,
        max_length=64,
        description="Canonical format (format_pick / idea_match).",
    )
    idea_text: Optional[str] = Field(
        None,
        max_length=4000,
        description="User idea for idea_match (also passed as extra focus).",
    )
    url: Optional[str] = Field(
        None,
        max_length=2048,
        description="Instagram reel URL for url_adapt.",
    )
    source_script: Optional[str] = Field(
        None,
        max_length=16_000,
        description="English talking-head script to adapt (script_adapt).",
    )
    selected_cta: Optional[SelectedCta] = Field(
        None,
        description=(
            "User-picked CTA from the client's CTA library. Snapshotted onto the "
            "session so caption / script / on-screen CTA stay coherent even if the "
            "library is later edited."
        ),
    )
    selected_carousel_template: Optional[SelectedCarouselTemplate] = Field(
        None,
        description=(
            "User-picked carousel template from the client's generation libraries. Snapshotted onto carousel "
            "sessions so slide order and visual references stay stable even if the "
            "template is later edited."
        ),
    )
    selected_cover_template: Optional[SelectedCoverTemplate] = Field(
        None,
        description=(
            "User-picked cover/thumbnail template from the client's generation libraries. Snapshotted onto "
            "sessions so the cover reference image and instructions stay stable even "
            "if the template is later edited."
        ),
    )
    carousel_slide_count: Optional[int] = Field(
        None,
        ge=3,
        le=10,
        description="Carousel length (3–10). Stored on the session; template refs cycle if count > references.",
    )
    recreate_mode: Optional[Literal["one_to_one", "adapt"]] = Field(
        None,
        description=(
            "url_adapt only. 'one_to_one' skips angle generation/selection and packages a strict 1:1 "
            "blueprint recreation (verbatim on-screen text translated to the client's language) directly, "
            "landing the session on content_ready. 'adapt' (or null) keeps the angle-selection flow."
        ),
    )


class GenerationRecommendFormatBody(BaseModel):
    idea: str = Field(..., min_length=3, max_length=4000)


class AutoVideoIdeaOut(BaseModel):
    """POST …/generate/auto-video-idea — LLM-proposed topic + format."""

    idea: str
    suggested_format_key: str
    reasoning: str


class GenerationChooseAngleBody(BaseModel):
    angle_index: int = Field(..., ge=0, le=9)
    extra_instruction: Optional[str] = Field(
        None,
        max_length=2000,
        description="Optional customization when user picks Anpassen instead of strict 1:1 recreation.",
    )


class GenerationRegenerateBody(BaseModel):
    # "story" regenerates only story_variants (3 IG Story teaser lines).
    # "text_blocks" is the new per-section regen scope used by the unified create screen.
    scope: Literal["hooks", "script", "caption", "story", "text_blocks", "all"] = "all"
    feedback: Optional[str] = Field(None, max_length=4000)


# GenerationFeedbackBody was removed alongside the deprecated /approve and
# /reject endpoints in the editor UX overhaul. If a future workflow needs a
# typed "feedback string" body, reintroduce it next to the specific endpoint
# that consumes it rather than reviving this orphan.


class PatchGenerationSessionBody(BaseModel):
    """PATCH …/generate/sessions/{id} — narrow artifact updates before slide/video assets exist."""

    model_config = ConfigDict(extra="ignore")

    selected_carousel_template: Optional[SelectedCarouselTemplate] = Field(
        None,
        description=(
            "Replace the carousel reference snapshot (backgrounds / roles). "
            "When carousel_slides already exist, set clear_carousel_slides=true to apply "
            "(this clears current slides; use Generate slides afterward)."
        ),
    )
    clear_carousel_slides: Optional[bool] = Field(
        None,
        description="When true with existing slides, clear carousel_slides and script outline so a new template applies.",
    )


class CoverSpec(BaseModel):
    """Persisted cover/thumbnail editor state.

    Mirrors the frontend ``CoverEditState`` so cover styling survives a refresh.
    Stored on ``generation_sessions.cover_spec`` (JSONB). The render endpoints
    read this as the source of truth when the request body omits overrides; the
    rendered ``thumbnail_url`` is a derived artifact.
    """

    model_config = ConfigDict(extra="ignore")

    crop_y: float = Field(0.5, ge=0.0, le=1.0)
    zoom: float = Field(1.0, ge=1.0, le=3.0)
    wash: bool = False
    template_id: VideoTemplateId = "centered-pop"
    theme_id: VideoThemeId = "bold-modern"
    text_treatment: Optional[Literal["bold-outline"]] = None
    layout: Optional[VideoSpecLayout] = None
    appearance: Optional[VideoSpecAppearance] = None
    hook_text: Optional[str] = Field(None, max_length=500)
    cover_mode: Optional[Literal["ai", "image"]] = None
    client_image_id: Optional[str] = Field(None, max_length=64)


class PatchCoverSpecBody(BaseModel):
    """PATCH …/generate/sessions/{id}/cover-spec — autosave the cover editor.

    Full replace (not RFC 6902 patch). Smaller and simpler than video_spec
    because the cover state is a flat ~10 fields rather than a deep tree.
    """

    model_config = ConfigDict(extra="ignore")

    cover_spec: CoverSpec


# ─────────────────────────────────────────────────────────────────────────────
# Phase F — variants endpoint (variant viewer in the Studio inspector)
# ─────────────────────────────────────────────────────────────────────────────


class GenerateVariantsBody(BaseModel):
    """POST …/generate/sessions/{id}/variants — request N AI alternates.

    The Studio inspector's `VariantsRail` calls this when the user wants
    side-by-side options (e.g. "give me 5 hooks", "5 caption rewrites"). The
    server runs the existing per-section regeneration with a multi-option
    prompt and persists the result on `generation_sessions.alternates` so
    they survive a refresh.

    `element_id` is only meaningful when `kind == "block"` (specific text
    block). For `hook` / `cover` / `caption` it's ignored.

    `n` is clamped server-side to [1, 8]. `feedback` is forwarded to the LLM
    as an optional steering hint (same shape as the existing /regenerate call).
    """

    model_config = ConfigDict(extra="ignore")

    kind: Literal["hook", "block", "cover", "caption"]
    element_id: Optional[str] = Field(None, max_length=128)
    n: int = Field(default=5, ge=1, le=8)
    feedback: Optional[str] = Field(None, max_length=500)


class VariantOption(BaseModel):
    """One alternate returned by /variants and stored on the session."""

    id: str
    text: str
    source: Literal["auto", "variants", "refine"] = "variants"
    created_at: str


class GenerateVariantsResponse(BaseModel):
    """Result envelope for POST /variants."""

    kind: Literal["hook", "block", "cover", "caption"]
    element_id: Optional[str] = None
    variants: List[VariantOption]


class GenerateThumbnailBody(BaseModel):
    """Optional override for the text rendered on the reel cover."""
    hook_text: Optional[str] = Field(None, max_length=500)
    # Keep generated backgrounds in full colour unless the user explicitly chooses a washed look.
    wash: bool = False
    template_id: VideoTemplateId = "centered-pop"
    theme_id: VideoThemeId = "bold-modern"
    text_treatment: Optional[Literal["bold-outline"]] = None
    layout: Optional[VideoSpecLayout] = None
    appearance: Optional[VideoSpecAppearance] = None


class ComposeThumbnailBody(BaseModel):
    """Compose a cover from an existing client image instead of AI-generated background."""
    client_image_id: str = Field(..., min_length=1, max_length=64)
    hook_text: Optional[str] = Field(None, max_length=500)
    # Whether to apply the editorial wash (desaturate + white blend) before drawing text.
    # Default False preserves the original colours; pass True only for an explicit washed look.
    wash: bool = False
    crop_y: float = Field(0.5, ge=0.0, le=1.0)
    zoom: float = Field(1.0, ge=1.0, le=3.0)
    template_id: VideoTemplateId = "centered-pop"
    theme_id: VideoThemeId = "bold-modern"
    text_treatment: Optional[Literal["bold-outline"]] = None
    layout: Optional[VideoSpecLayout] = None
    appearance: Optional[VideoSpecAppearance] = None


class CarouselSlide(BaseModel):
    """One slide in a generation_sessions.carousel_slides JSONB array."""

    model_config = ConfigDict(extra="ignore")

    idx: int = Field(..., ge=0, le=9)
    text: str = Field("", max_length=600)
    # Background image without burned-in text (composition base layer).
    base_image_url: Optional[str] = None
    image_url: Optional[str] = None
    prompt: Optional[str] = Field(None, max_length=2000)
    layout: Optional[VideoSpecLayout] = None
    text_box: Optional[CarouselTextBox] = None
    background_style: Optional[CarouselBackgroundStyle] = None


class GenerateCarouselSlidesBody(BaseModel):
    """POST …/create/sessions/{id}/carousel-slides/generate"""

    count: int = Field(6, ge=3, le=10)
    style: Optional[str] = Field(
        None,
        max_length=200,
        description="Optional editorial style hint forwarded to the image generator.",
    )


class RegenerateCarouselSlideBody(BaseModel):
    """POST …/create/sessions/{id}/carousel-slides/regenerate — one slide at a time."""

    idx: int = Field(..., ge=0, le=9)
    text: Optional[str] = Field(None, max_length=600)
    prompt: Optional[str] = Field(
        None,
        max_length=2000,
        description="Optional steering note forwarded to the image generator.",
    )
    image_source: Literal["ai", "client_image"] = "ai"
    client_image_id: Optional[str] = Field(None, min_length=1, max_length=64)
    layout: Optional[VideoSpecLayout] = None
    text_box: Optional[CarouselTextBox] = None


class PatchCarouselSlidesBody(BaseModel):
    """PATCH …/create/sessions/{id}/carousel-slides — manual text/layout edits (no re-render)."""

    slides: List[CarouselSlide] = Field(..., min_length=1, max_length=10)


class PatchVideoSpecBody(BaseModel):
    """PATCH …/create/sessions/{id}/spec — RFC 6902 JSON Patch on video_spec."""

    model_config = ConfigDict(extra="ignore")

    ops: List[Dict[str, Any]] = Field(default_factory=list)


class PromptVideoSpecBody(BaseModel):
    """POST …/create/sessions/{id}/spec/prompt-edit — natural language → JSON Patch preview."""

    instruction: str = Field(..., min_length=3, max_length=4000)


class GenerationSessionOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    client_id: str
    source_type: str
    source_analysis_ids: Optional[List[str]] = None
    source_reel_ids: Optional[List[str]] = None
    source_format_key: Optional[str] = None
    source_url: Optional[str] = None
    source_idea: Optional[str] = None
    source_script: Optional[str] = None
    synthesized_patterns: Optional[Dict[str, Any]] = None
    angles: Optional[List[Dict[str, Any]]] = None
    chosen_angle_index: Optional[int] = None
    hooks: Optional[List[Dict[str, Any]]] = None
    script: Optional[str] = None
    caption_body: Optional[str] = None
    hashtags: Optional[List[str]] = None
    story_variants: Optional[List[str]] = None
    text_blocks: Optional[List[Dict[str, Any]]] = None
    video_spec: Optional[Dict[str, Any]] = None
    cover_text_options: Optional[List[str]] = None
    background_type: Optional[str] = None
    broll_clip_id: Optional[str] = None
    client_image_id: Optional[str] = None
    background_url: Optional[str] = None
    rendered_video_url: Optional[str] = None
    render_status: Optional[str] = None
    render_error: Optional[str] = None
    render_progress_pct: Optional[int] = None
    thumbnail_url: Optional[str] = None
    cover_spec: Optional[Dict[str, Any]] = None
    alternates: Optional[Dict[str, Any]] = None
    carousel_slides: Optional[List[CarouselSlide]] = None
    selected_cta: Optional[Dict[str, Any]] = None
    selected_carousel_template: Optional[Dict[str, Any]] = None
    selected_cover_template: Optional[Dict[str, Any]] = None
    carousel_slide_count: Optional[int] = None
    status: str
    feedback: Optional[str] = None
    prompt_version: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
