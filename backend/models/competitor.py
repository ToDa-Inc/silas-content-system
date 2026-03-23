from typing import List, Optional

from pydantic import BaseModel, ConfigDict


class CompetitorOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    client_id: str
    username: str
    profile_url: Optional[str]
    followers: Optional[int]
    avg_views: Optional[int]
    avg_likes: Optional[int]
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


class DiscoverBody(BaseModel):
    keyword: Optional[str] = None
    limit: int = 15
    threshold: int = 60
    posts_per_account: int = 8
