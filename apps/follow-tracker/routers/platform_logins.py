"""Platform-level login credentials.

Per-platform cookie blob that acts as the default for every creator on
that platform without their own override. The Subscriptions page uses
this so a single QR scan logs the whole tracker into Bilibili instead
of forcing one cookie-paste per creator.

The cookie value itself is never echoed back over the wire — only the
``hasCookies`` boolean and ``updatedAt`` timestamp — so a careless
``GET /api/platform-logins`` won't surface SESSDATA in browser history.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from db import PlatformCredential, session_scope


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/platform-logins")


# Platforms we know how to pull from. YouTube login support is reserved
# for future work (yt-dlp accepts a Netscape cookies.txt rather than a
# header blob), but we still surface the row so the UI can render an
# "unsupported / coming soon" state without special-casing.
SUPPORTED_PLATFORMS = ("bilibili", "youtube")


class PlatformLoginOut(BaseModel):
    platform: str
    has_cookies: bool = Field(serialization_alias="hasCookies")
    updated_at: Optional[dt.datetime] = Field(default=None, serialization_alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)


class PlatformLoginListResponse(BaseModel):
    items: list[PlatformLoginOut]


class PlatformLoginIn(BaseModel):
    cookies: str

    model_config = ConfigDict(populate_by_name=True)


def _row_to_out(platform: str, row: Optional[PlatformCredential]) -> PlatformLoginOut:
    if row is None:
        return PlatformLoginOut(platform=platform, has_cookies=False, updated_at=None)
    return PlatformLoginOut(
        platform=platform,
        has_cookies=bool(row.cookies),
        updated_at=row.updated_at,
    )


@router.get("", response_model=PlatformLoginListResponse)
def list_platform_logins() -> PlatformLoginListResponse:
    items: list[PlatformLoginOut] = []
    with session_scope() as s:
        for platform in SUPPORTED_PLATFORMS:
            row = s.get(PlatformCredential, platform)
            items.append(_row_to_out(platform, row))
    return PlatformLoginListResponse(items=items)


@router.put("/{platform}", response_model=PlatformLoginOut)
def upsert_platform_login(platform: str, body: PlatformLoginIn) -> PlatformLoginOut:
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail=f"unknown platform: {platform}")
    cookies = (body.cookies or "").strip()
    if not cookies:
        raise HTTPException(status_code=400, detail="cookies must not be empty")

    with session_scope() as s:
        row = s.get(PlatformCredential, platform)
        if row is None:
            row = PlatformCredential(platform=platform, cookies=cookies)
            s.add(row)
        else:
            row.cookies = cookies
        s.flush()
        return _row_to_out(platform, row)


@router.delete("/{platform}", response_model=PlatformLoginOut)
def delete_platform_login(platform: str) -> PlatformLoginOut:
    if platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail=f"unknown platform: {platform}")
    with session_scope() as s:
        row = s.get(PlatformCredential, platform)
        if row is not None:
            s.delete(row)
    return PlatformLoginOut(platform=platform, has_cookies=False, updated_at=None)
