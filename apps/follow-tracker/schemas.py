"""Pydantic models for request/response shapes.

Field names are camelCase on the wire to match the rest of the admin-ui
ecosystem (axios + React Query callers expect camelCase). Internal SQL
columns stay snake_case; the API layer translates."""

from __future__ import annotations

import datetime as dt
import json
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CreatorIn(BaseModel):
    platform: str = Field(pattern="^(bilibili|youtube)$")
    external_id: Optional[str] = Field(default=None, alias="externalId")
    name: Optional[str] = None
    auto_download: bool = Field(default=True, alias="autoDownload")

    model_config = ConfigDict(populate_by_name=True)


class CreatorPatch(BaseModel):
    name: Optional[str] = None
    auto_download: Optional[bool] = Field(default=None, alias="autoDownload")

    model_config = ConfigDict(populate_by_name=True)


class CreatorOut(BaseModel):
    id: int
    platform: str
    external_id: str = Field(serialization_alias="externalId")
    name: str
    auto_download: bool = Field(serialization_alias="autoDownload")
    last_checked_at: Optional[dt.datetime] = Field(default=None, serialization_alias="lastCheckedAt")
    last_error: Optional[str] = Field(default=None, serialization_alias="lastError")
    created_at: dt.datetime = Field(serialization_alias="createdAt")
    video_count: int = Field(default=0, serialization_alias="videoCount")

    model_config = ConfigDict(populate_by_name=True)


class VideoOut(BaseModel):
    id: int
    creator_id: int = Field(serialization_alias="creatorId")
    external_id: str = Field(serialization_alias="externalId")
    title: str
    url: str
    pub_date: Optional[str] = Field(default=None, serialization_alias="pubDate")
    duration: Optional[str] = None
    cover_url: Optional[str] = Field(default=None, serialization_alias="coverUrl")
    status: str
    download_id: Optional[int] = Field(default=None, serialization_alias="downloadId")
    file_path: Optional[str] = Field(default=None, serialization_alias="filePath")
    ai_status: Optional[str] = Field(default=None, serialization_alias="aiStatus")
    ai_job_id: Optional[str] = Field(default=None, serialization_alias="aiJobId")
    notes: Optional[dict[str, Any]] = None
    discovered_at: dt.datetime = Field(serialization_alias="discoveredAt")
    updated_at: dt.datetime = Field(serialization_alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("notes", mode="before")
    @classmethod
    def parse_notes(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return None
        return v


class CreatorListResponse(BaseModel):
    items: list[CreatorOut]
    total: int


class VideoListResponse(BaseModel):
    items: list[VideoOut]
    total: int


class RefreshSummary(BaseModel):
    creator_id: int = Field(serialization_alias="creatorId")
    discovered: int
    queued: int
    duration_seconds: float = Field(serialization_alias="durationSeconds")
    error: Optional[str] = None
