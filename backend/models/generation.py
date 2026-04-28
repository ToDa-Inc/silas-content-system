from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from models.video_spec import VideoSpecAppearance, VideoSpecLayout, VideoTemplateId, VideoThemeId


class SelectedCta(BaseModel):
    """Snapshot of the CTA the user picked under the format selector.

    Stored on each ``generation_sessions`` row so old sessions stay stable even
    if the client later edits their CTA library in Context.
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
            "User-picked carousel template from Context. Snapshotted onto carousel "
            "sessions so slide order and visual references stay stable even if the "
            "template is later edited."
        ),
    )
    selected_cover_template: Optional[SelectedCoverTemplate] = Field(
        None,
        description=(
            "User-picked cover/thumbnail template from Context. Snapshotted onto "
            "sessions so the cover reference image and instructions stay stable even "
            "if the template is later edited."
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


class GenerationRegenerateBody(BaseModel):
    # "story" is kept for backwards-compat with old API callers; new sessions don't have story_variants.
    # "text_blocks" is the new per-section regen scope used by the unified create screen.
    scope: Literal["hooks", "script", "caption", "story", "text_blocks", "all"] = "all"
    feedback: Optional[str] = Field(None, max_length=4000)


class GenerationFeedbackBody(BaseModel):
    feedback: Optional[str] = Field(None, max_length=4000)


class GenerateThumbnailBody(BaseModel):
    """Optional override for the text rendered on the reel cover."""
    hook_text: Optional[str] = Field(None, max_length=500)
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
    # Default True keeps the same look as the AI cover; pass False to keep original colours.
    wash: bool = True
    crop_y: float = Field(0.5, ge=0.0, le=1.0)
    zoom: float = Field(1.0, ge=1.0, le=2.0)
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
    image_url: Optional[str] = None
    prompt: Optional[str] = Field(None, max_length=2000)


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


class PatchCarouselSlidesBody(BaseModel):
    """PATCH …/create/sessions/{id}/carousel-slides — manual text-only edits."""

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
    carousel_slides: Optional[List[CarouselSlide]] = None
    selected_cta: Optional[Dict[str, Any]] = None
    selected_carousel_template: Optional[Dict[str, Any]] = None
    selected_cover_template: Optional[Dict[str, Any]] = None
    status: str
    feedback: Optional[str] = None
    prompt_version: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
