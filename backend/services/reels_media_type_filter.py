from typing import Any, Optional


REELS_MEDIA_TYPE_ALL = "all"
REELS_MEDIA_TYPE_SHORT = "short"
REELS_MEDIA_TYPE_LONG = "long"
REELS_MEDIA_TYPE_CAROUSEL = "carousel"

VALID_REELS_MEDIA_TYPES = frozenset(
    {
        REELS_MEDIA_TYPE_ALL,
        REELS_MEDIA_TYPE_SHORT,
        REELS_MEDIA_TYPE_LONG,
        REELS_MEDIA_TYPE_CAROUSEL,
    }
)


def normalize_reels_media_type(value: Optional[str]) -> str:
    if not value:
        return REELS_MEDIA_TYPE_ALL
    media_type = value.strip().lower()
    return media_type if media_type in VALID_REELS_MEDIA_TYPES else REELS_MEDIA_TYPE_ALL


def apply_reels_media_type_filter(query: Any, media_type: Optional[str]) -> Any:
    normalized = normalize_reels_media_type(media_type)
    if normalized == REELS_MEDIA_TYPE_SHORT:
        return query.neq("format", REELS_MEDIA_TYPE_CAROUSEL).lt("video_duration", 15)
    if normalized == REELS_MEDIA_TYPE_LONG:
        return query.neq("format", REELS_MEDIA_TYPE_CAROUSEL).gt("video_duration", 15)
    if normalized == REELS_MEDIA_TYPE_CAROUSEL:
        return query.eq("format", REELS_MEDIA_TYPE_CAROUSEL)
    return query
