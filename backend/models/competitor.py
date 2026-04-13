from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class CompetitorOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    client_id: str
    username: str
    profile_url: Optional[str]
    followers: Optional[int]
    avg_views: Optional[int]
    avg_likes: Optional[int]
    avg_comments: Optional[int] = None
    language: Optional[str]
    content_style: Optional[str]
    topics: Optional[List[str]]
    reasoning: Optional[str]
    relevance_score: Optional[int]
    performance_score: Optional[int]
    language_bonus: Optional[int]
    composite_score: Optional[int]
    tier: Optional[int]
    tier_label: Optional[str]
    added_by: Optional[str] = None
    discovery_job_id: Optional[str] = None


class CompetitorPreviewBody(BaseModel):
    """Paste @handle or Instagram profile URL."""

    input: str = Field(..., description="Username, @username, or instagram.com/… URL")


class CompetitorAddBody(BaseModel):
    input: str = Field(..., description="Same as preview — re-scraped on save")
    added_by: Optional[str] = Field(None, max_length=200)


class ScrapeCompetitorReelsBody(BaseModel):
    """Apify reel batch size for one competitor (profile_scrape)."""

    limit: int = Field(default=15, ge=1, le=50, description="Max reels to fetch from Apify for this account")


class DiscoverBody(BaseModel):
    """Matches scripts: competitor-discovery.js (single keyword) + competitor-batch-discover.js (keywords / --lang)."""

    keyword: Optional[str] = None
    keywords: Optional[List[str]] = None
    keyword_mode: str = Field(
        default="all",
        description='Which niche keywords to use: "all" (keywords_de + keywords), "de", "en" — like batch script --lang',
    )
    limit: int = 15
    threshold: int = 60
    posts_per_account: int = 8


class NicheReelScrapeBody(BaseModel):
    """Queue niche keyword reel search + enrich into scraped_reels (no competitors)."""

    keyword: Optional[str] = None
    keywords: Optional[List[str]] = None
    keyword_mode: str = Field(
        default="all",
        description='Same as discovery: "all" | "de" | "en" for niche_config keywords',
    )
    max_items_per_keyword: int = Field(default=25, ge=5, le=80)
    max_total_reels: int = Field(default=50, ge=5, le=200)
    include_hashtags: bool = True
    max_hashtag_queries: int = Field(default=6, ge=0, le=12)
