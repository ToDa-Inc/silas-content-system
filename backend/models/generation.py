from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


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
    background_type: Optional[str] = None
    broll_clip_id: Optional[str] = None
    background_url: Optional[str] = None
    rendered_video_url: Optional[str] = None
    render_status: Optional[str] = None
    render_error: Optional[str] = None
    thumbnail_url: Optional[str] = None
    status: str
    feedback: Optional[str] = None
    prompt_version: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
