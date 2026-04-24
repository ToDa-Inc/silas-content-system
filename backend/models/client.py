from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class ClientCreate(BaseModel):
    slug: str
    name: str
    instagram_handle: Optional[str] = None
    language: str = "de"
    niche_config: List[Any] = Field(default_factory=list)
    icp: dict = Field(default_factory=dict)
    products: dict = Field(default_factory=dict)
    client_context: dict = Field(default_factory=dict)


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    instagram_handle: Optional[str] = None
    language: Optional[str] = None
    niche_config: Optional[List[Any]] = None
    icp: Optional[dict] = None
    products: Optional[dict] = None
    client_context: Optional[dict] = None
    is_active: Optional[bool] = None
    outlier_ratio_threshold: Optional[float] = None


class DnaChatUpdateBody(BaseModel):
    """Natural-language instruction to propose edits to client_dna.analysis_brief (preview)."""

    message: str = Field(..., min_length=10, max_length=2000)


class DnaChatApplyBody(BaseModel):
    """Apply preview from POST …/dna/chat-preview. Only ``analysis_brief`` is read from changed_sections."""

    changed_sections: Dict[str, str] = Field(default_factory=dict)
    summary: Optional[str] = Field(None, max_length=4000)


class NicheConfigPatch(BaseModel):
    """Partial update for client_context.niche (manual keywords, blacklist, settings)."""

    keywords_manual: Optional[List[Any]] = None
    blacklist: Optional[Dict[str, Any]] = None
    settings: Optional[Dict[str, Any]] = None
    dismissed_short_codes: Optional[List[str]] = None


class ClientOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    org_id: str
    slug: str
    name: str
    instagram_handle: Optional[str]
    language: str
    niche_config: List[Any]
    icp: dict
    products: dict
    client_context: Optional[dict] = None
    client_dna: Optional[dict] = None
    brand_theme: Optional[dict] = None
    is_active: bool
    outlier_ratio_threshold: Optional[float] = None


class BrandThemePatch(BaseModel):
    """PATCH …/clients/{slug}/brand-theme — partial update of JSON brand_theme."""

    model_config = ConfigDict(extra="ignore")

    primary: Optional[str] = Field(default=None, max_length=32)
    accent: Optional[str] = Field(default=None, max_length=32)
    defaultThemeId: Optional[str] = Field(
        default=None,
        max_length=32,
        description="bold-modern | editorial | casual-hand | clean-minimal",
    )
