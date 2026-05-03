from __future__ import annotations

import datetime as dt

from fastapi import APIRouter
from sqlalchemy import func, select

from db import Creator, Video, session_scope


router = APIRouter()


@router.get("/health")
def health() -> dict:
    with session_scope() as s:
        creators = s.scalar(select(func.count(Creator.id))) or 0
        videos = s.scalar(select(func.count(Video.id))) or 0
        last_check = s.scalar(select(func.max(Creator.last_checked_at)))
    return {
        "status": "ok",
        "creators": creators,
        "videos": videos,
        "last_checked_at": last_check.isoformat() if isinstance(last_check, dt.datetime) else None,
    }
