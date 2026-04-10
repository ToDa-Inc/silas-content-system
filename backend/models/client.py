from typing import Any, List, Optional

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
    """Natural-language instruction to surgically update client_context strategy sections."""

    message: str = Field(..., min_length=10, max_length=2000)


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
    is_active: bool
    outlier_ratio_threshold: Optional[float] = None
