"""Read-side and manual-action endpoints for discovered videos."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select

from db import Video, session_scope
from schemas import VideoListResponse, VideoOut
from services.mediago_client import MediagoClient


router = APIRouter()


def _to_out(v: Video) -> VideoOut:
    return VideoOut(
        id=v.id,
        creator_id=v.creator_id,
        external_id=v.external_id,
        title=v.title,
        url=v.url,
        pub_date=v.pub_date,
        duration=v.duration,
        cover_url=v.cover_url,
        status=v.status,
        download_id=v.download_id,
        file_path=v.file_path,
        failure_category=v.failure_category,
        failure_reason=v.failure_reason,
        failure_log_excerpt=v.failure_log_excerpt,
        retry_count=v.retry_count,
        last_retry_at=v.last_retry_at,
        ai_status=v.ai_status,
        ai_job_id=v.ai_job_id,
        notes=v.notes_json,  # validator parses JSON
        is_paid_preview=bool(v.is_paid_preview),
        actual_duration_seconds=v.actual_duration_seconds,
        discovered_at=v.discovered_at,
        updated_at=v.updated_at,
    )


@router.get("/creators/{creator_id}/videos", response_model=VideoListResponse)
def list_creator_videos(
    creator_id: int,
    status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
) -> VideoListResponse:
    with session_scope() as s:
        q = select(Video).where(Video.creator_id == creator_id).order_by(Video.discovered_at.desc())
        if status:
            q = q.where(Video.status == status)
        total = s.scalar(select(func.count(Video.id)).where(Video.creator_id == creator_id)) or 0
        rows = list(s.scalars(q.offset(offset).limit(limit)))
        items = [_to_out(v) for v in rows]
    return VideoListResponse(items=items, total=int(total))


@router.get("/videos/{video_id}", response_model=VideoOut)
def get_video(video_id: int) -> VideoOut:
    with session_scope() as s:
        v = s.get(Video, video_id)
        if v is None:
            raise HTTPException(status_code=404, detail="video not found")
        return _to_out(v)


@router.post("/videos/{video_id}/queue", response_model=VideoOut)
def queue_video(video_id: int) -> VideoOut:
    """Manually push a discovered video into mediago-core's download queue.

    For creators with auto_download=false, this is the user-facing
    'download this one' button.
    """
    mediago = MediagoClient()
    try:
        with session_scope() as s:
            v = s.get(Video, video_id)
            if v is None:
                raise HTTPException(status_code=404, detail="video not found")
            if v.status not in ("discovered", "skipped", "failed"):
                # already queued / succeeded — nothing to do
                return _to_out(v)
            platform = v.creator.platform
            url = v.url
            video_pk = v.id
            title = v.title
            creator_name = v.creator.name

        from services.refresh import _download_type_for, safe_segment  # local import to avoid cycle

        safe_title = safe_segment(title)
        download_id = mediago.enqueue(
            url=url,
            download_type=_download_type_for(platform),
            name=safe_title,
            folder=f"{safe_segment(creator_name)}/{safe_title}",
            start=True,
        )
        with session_scope() as s:
            v = s.get(Video, video_pk)
            if v is None:
                raise HTTPException(status_code=404, detail="video disappeared")
            v.status = "queued"
            v.download_id = download_id
            return _to_out(v)
    finally:
        mediago.close()


@router.post("/videos/{video_id}/skip", response_model=VideoOut)
def skip_video(video_id: int) -> VideoOut:
    with session_scope() as s:
        v = s.get(Video, video_id)
        if v is None:
            raise HTTPException(status_code=404, detail="video not found")
        v.status = "skipped"
        return _to_out(v)
