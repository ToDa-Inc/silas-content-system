from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class AnalyzeReelUrlBody(BaseModel):
    """POST /clients/{slug}/reels/analyze-url — see docs/ANALYZE-REEL-ENDPOINT-SPEC.md."""

    url: str = Field(..., min_length=12, description="Instagram reel or post URL")


class TopicSearchBody(BaseModel):
    """POST /clients/{slug}/search/topics — keyword reel search (Sasky actor)."""

    keyword: str = Field(..., min_length=2, max_length=200)
    max_items: int = Field(50, ge=1, le=200)


class ReelAnalysisSummary(BaseModel):
    """Embedded on scraped reel rows when include_analysis=true."""

    model_config = ConfigDict(extra="ignore")

    id: str
    total_score: Optional[int] = None
    replicability_rating: Optional[str] = None
    analyzed_at: Optional[str] = None


class ReelAnalysisDetailOut(BaseModel):
    """Full Silas analysis for one reel — GET …/reels/{reel_id}/analysis."""

    model_config = ConfigDict(extra="ignore")

    id: str
    client_id: str
    reel_id: Optional[str] = None
    analysis_job_id: Optional[str] = None
    source: str = "analyze_url"
    post_url: str
    owner_username: Optional[str] = None

    instant_hook_score: Optional[int] = None
    relatability_score: Optional[int] = None
    cognitive_tension_score: Optional[int] = None
    clear_value_score: Optional[int] = None
    comment_trigger_score: Optional[int] = None
    total_score: Optional[int] = None
    replicability_rating: Optional[str] = None

    full_analysis_json: Optional[Dict[str, Any]] = None
    model_used: Optional[str] = None
    prompt_version: Optional[str] = None
    video_analyzed: Optional[bool] = None
    analyzed_at: Optional[str] = None
    created_at: Optional[str] = None


class ReelAnalysisOut(BaseModel):
    """Row from reel_analyses — list endpoint (no full JSON)."""

    model_config = ConfigDict(extra="ignore")

    id: str
    client_id: str
    reel_id: Optional[str] = None
    analysis_job_id: Optional[str] = None
    source: str = "analyze_url"
    post_url: str
    owner_username: Optional[str] = None

    instant_hook_score: Optional[int] = None
    relatability_score: Optional[int] = None
    cognitive_tension_score: Optional[int] = None
    clear_value_score: Optional[int] = None
    comment_trigger_score: Optional[int] = None
    total_score: Optional[int] = None
    replicability_rating: Optional[str] = None

    model_used: Optional[str] = None
    prompt_version: Optional[str] = None
    video_analyzed: Optional[bool] = None
    analyzed_at: Optional[str] = None
    created_at: Optional[str] = None


class ScrapedReelOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    client_id: str
    competitor_id: Optional[str] = None
    post_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    account_username: str
    account_avg_views: Optional[int] = None
    views: Optional[int] = None
    likes: Optional[int] = None
    comments: Optional[int] = None
    saves: Optional[int] = None
    shares: Optional[int] = None
    outlier_ratio: Optional[float] = None
    is_outlier: Optional[bool] = None
    hook_text: Optional[str] = None
    caption: Optional[str] = None
    hashtags: Optional[List[str]] = None
    posted_at: Optional[str] = None
    format: Optional[str] = None
    source: Optional[str] = None
    first_seen_at: Optional[str] = None
    last_updated_at: Optional[str] = None
    created_at: Optional[str] = None
    analysis: Optional[ReelAnalysisSummary] = None
