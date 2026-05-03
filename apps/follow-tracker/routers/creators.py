"""CRUD + manual refresh for tracked creators.

Adding a Bilibili creator accepts either a numeric mid (we just
fetch the nickname for display) or a name (we resolve via Selenium-driven
search to find the most-relevant matching mid). YouTube creators must
be added by channel_id — there's no good way to disambiguate by name
without auth tokens.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException
from sqlalchemy import func, select

from db import Creator, Video, session_scope
from schemas import (
    CreatorIn,
    CreatorListResponse,
    CreatorOut,
    CreatorPatch,
    RefreshSummary,
)
from services.mediago_client import MediagoClient
from services.refresh import refresh_creator
from sources import resolve_bilibili_creator
from sources.base import SourceError


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/creators")


@router.get("", response_model=CreatorListResponse)
def list_creators() -> CreatorListResponse:
    with session_scope() as s:
        rows = list(s.scalars(select(Creator).order_by(Creator.created_at.desc())))
        items: list[CreatorOut] = []
        for c in rows:
            count = s.scalar(select(func.count(Video.id)).where(Video.creator_id == c.id)) or 0
            items.append(
                CreatorOut(
                    id=c.id,
                    platform=c.platform,
                    external_id=c.external_id,
                    name=c.name,
                    auto_download=bool(c.auto_download),
                    has_cookies=bool((c.cookies or "").strip()),
                    last_checked_at=c.last_checked_at,
                    last_error=c.last_error,
                    created_at=c.created_at,
                    video_count=int(count),
                )
            )
    return CreatorListResponse(items=items, total=len(items))


@router.post("", response_model=CreatorOut, status_code=201)
def add_creator(body: CreatorIn) -> CreatorOut:
    platform = body.platform
    external_id = (body.external_id or "").strip()
    name = (body.name or "").strip()
    cookies = (body.cookies or "").strip() or None

    if platform == "bilibili":
        # Accept either a mid or a free-form name in either field.
        candidate = external_id or name
        if not candidate:
            raise HTTPException(status_code=400, detail="provide externalId (mid) or name")
        try:
            # Resolve with the same cookies we'll persist — risk-control
            # rejects the resolve API as readily as the search API.
            mid, resolved = resolve_bilibili_creator(candidate, cookies=cookies)
        except SourceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        external_id = mid
        if not name:
            name = resolved
    elif platform == "youtube":
        if not external_id:
            raise HTTPException(status_code=400, detail="provide externalId (channel_id like UCxxxx…)")
        if not name:
            name = external_id
    else:
        raise HTTPException(status_code=400, detail=f"unknown platform: {platform}")

    with session_scope() as s:
        existing = s.scalars(
            select(Creator).where(Creator.platform == platform, Creator.external_id == external_id)
        ).first()
        if existing is not None:
            raise HTTPException(status_code=409, detail="creator already tracked")
        c = Creator(
            platform=platform,
            external_id=external_id,
            name=name,
            auto_download=1 if body.auto_download else 0,
            cookies=cookies,
        )
        s.add(c)
        s.flush()
        return CreatorOut(
            id=c.id,
            platform=c.platform,
            external_id=c.external_id,
            name=c.name,
            auto_download=bool(c.auto_download),
            has_cookies=bool(c.cookies),
            last_checked_at=c.last_checked_at,
            last_error=c.last_error,
            created_at=c.created_at,
            video_count=0,
        )


@router.patch("/{creator_id}", response_model=CreatorOut)
def patch_creator(creator_id: int, body: CreatorPatch) -> CreatorOut:
    with session_scope() as s:
        c = s.get(Creator, creator_id)
        if c is None:
            raise HTTPException(status_code=404, detail="creator not found")
        if body.name is not None:
            c.name = body.name
        if body.auto_download is not None:
            c.auto_download = 1 if body.auto_download else 0
        if body.cookies is not None:
            # Empty string clears; otherwise replace.
            stripped = body.cookies.strip()
            c.cookies = stripped or None
        s.flush()
        count = s.scalar(select(func.count(Video.id)).where(Video.creator_id == c.id)) or 0
        return CreatorOut(
            id=c.id,
            platform=c.platform,
            external_id=c.external_id,
            name=c.name,
            auto_download=bool(c.auto_download),
            has_cookies=bool(c.cookies),
            last_checked_at=c.last_checked_at,
            last_error=c.last_error,
            created_at=c.created_at,
            video_count=int(count),
        )


@router.delete("/{creator_id}")
def delete_creator(creator_id: int) -> dict:
    with session_scope() as s:
        c = s.get(Creator, creator_id)
        if c is None:
            raise HTTPException(status_code=404, detail="creator not found")
        s.delete(c)
    return {"deleted": creator_id}


@router.post("/{creator_id}/refresh", response_model=RefreshSummary)
def refresh_now(creator_id: int, background: BackgroundTasks) -> RefreshSummary:
    """Synchronously kick off a refresh and return the summary.

    Selenium-backed refreshes can take 10-60 seconds; we accept the wait
    so the caller gets immediate feedback. For long-running cases the
    scheduler will pick it up anyway on the next tick.
    """
    mediago = MediagoClient()
    try:
        summary = refresh_creator(creator_id, mediago=mediago)
    finally:
        mediago.close()

    if summary.get("error") == "creator not found":
        raise HTTPException(status_code=404, detail="creator not found")

    return RefreshSummary(
        creator_id=summary["creator_id"],
        discovered=summary["discovered"],
        queued=summary["queued"],
        duration_seconds=summary["duration_seconds"],
        error=summary["error"],
    )
