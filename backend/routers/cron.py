from typing import Annotated, Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status

from core.config import Settings, get_settings
from core.database import get_supabase
from services.scrape_cycle import enqueue_stale_profile_scrapes_all_clients

router = APIRouter(prefix="/api/v1/cron", tags=["cron"])


@router.post("/scrape-cycle", status_code=status.HTTP_200_OK)
def scrape_cycle(
    settings: Annotated[Settings, Depends(get_settings)],
    x_cron_secret: Annotated[Optional[str], Header(alias="X-Cron-Secret")] = None,
) -> Dict[str, Any]:
    """External scheduler: enqueue profile_scrape for stale competitors (tiers 1–3)."""
    if not settings.cron_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CRON_SECRET not configured",
        )
    if not x_cron_secret or x_cron_secret != settings.cron_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid cron secret")

    supabase = get_supabase()
    stats = enqueue_stale_profile_scrapes_all_clients(supabase)
    return stats
