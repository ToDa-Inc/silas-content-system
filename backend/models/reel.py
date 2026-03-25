from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict


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
