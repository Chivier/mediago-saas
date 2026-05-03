"""Background poller.

For every video in ``status=queued`` with a ``download_id``, ask
mediago-core for the current download state. On ``success``, transition
to ``succeeded``, capture the file path, and (when ``AUTO_AI_PROCESSING``
is on) submit the file to the AI service for note generation.

Then, for every video sitting in ``ai_status in (pending, processing)``,
poll the AI service for completion and persist the JSON payload.

Designed to be called every ``DOWNLOAD_POLL_SECONDS`` from APScheduler.
A single tick runs in linear time over the small set of in-flight
videos; for thousands of subscriptions we'd batch the queries.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
from typing import Optional

from sqlalchemy import select

from config import AUTO_AI_PROCESSING, STORAGE_PATH
from db import Video, session_scope

from .ai_client import AIClient, AIClientError
from .mediago_client import MediagoClient, MediagoClientError


logger = logging.getLogger(__name__)


def poll_once() -> dict:
    """Run one tick of the post-download poller. Returns counts for logs."""
    summary = {"checked": 0, "promoted": 0, "ai_submitted": 0, "ai_done": 0}

    mediago = MediagoClient()
    ai = AIClient()
    try:
        _poll_downloads(mediago, ai, summary)
        _catch_up_missing_ai(ai, summary)
        _poll_ai_jobs(ai, summary)
    finally:
        mediago.close()
        ai.close()

    return summary


def _catch_up_missing_ai(ai: AIClient, summary: dict) -> None:
    """Backfill AI submissions for videos that finished downloading but
    never made it into the AI pipeline.

    Two ways a video lands here:

    * The download finished BEFORE the AI service was healthy, so the
      submission attempt blew up and we recorded ``ai_status=failed``;
      an operator later cleared it back to NULL.
    * AUTO_AI_PROCESSING was off when the download completed and is on now.
    """
    if not AUTO_AI_PROCESSING:
        return

    with session_scope() as s:
        rows = list(
            s.scalars(
                select(Video)
                .where(Video.status == "succeeded")
                .where(Video.file_path.is_not(None))
                .where(Video.ai_status.is_(None))
                .limit(20)  # cap per-tick so a big backlog drips out instead of stampeding
            )
        )

    for row in rows:
        try:
            job_id = ai.submit_notes(file_path=row.file_path, title=row.title)
        except AIClientError as exc:
            logger.warning("catch-up: ai submit failed for video %s: %s", row.id, exc)
            with session_scope() as s:
                v = s.get(Video, row.id)
                if v is not None:
                    v.ai_status = "failed"
                    v.updated_at = dt.datetime.now(dt.timezone.utc)
            continue
        with session_scope() as s:
            v = s.get(Video, row.id)
            if v is not None:
                v.ai_status = "pending"
                v.ai_job_id = job_id
        summary["ai_submitted"] += 1


def _poll_downloads(mediago: MediagoClient, ai: AIClient, summary: dict) -> None:
    with session_scope() as s:
        rows = list(
            s.scalars(
                select(Video).where(Video.status == "queued").where(Video.download_id.is_not(None))
            )
        )

    for row in rows:
        summary["checked"] += 1
        try:
            data = mediago.get_download(row.download_id)
        except MediagoClientError as exc:
            logger.warning("poll: get_download(%s) failed: %s", row.download_id, exc)
            continue
        if data is None:
            continue
        status = data.get("status")
        if status == "success":
            file_path = _resolve_file_path(data)
            with session_scope() as s:
                v = s.get(Video, row.id)
                if v is None:
                    continue
                v.status = "succeeded"
                v.file_path = file_path
                v.updated_at = dt.datetime.now(dt.timezone.utc)
            summary["promoted"] += 1

            if AUTO_AI_PROCESSING and file_path:
                try:
                    job_id = ai.submit_notes(file_path=file_path, title=row.title)
                except AIClientError as exc:
                    logger.warning("ai submit failed for video %s: %s", row.id, exc)
                    continue
                with session_scope() as s:
                    v = s.get(Video, row.id)
                    if v is not None:
                        v.ai_status = "pending"
                        v.ai_job_id = job_id
                summary["ai_submitted"] += 1
        elif status == "failed":
            with session_scope() as s:
                v = s.get(Video, row.id)
                if v is not None:
                    v.status = "failed"
                    v.updated_at = dt.datetime.now(dt.timezone.utc)


def _poll_ai_jobs(ai: AIClient, summary: dict) -> None:
    with session_scope() as s:
        rows = list(
            s.scalars(
                select(Video)
                .where(Video.ai_job_id.is_not(None))
                .where(Video.ai_status.in_(["pending", "processing"]))
            )
        )

    for row in rows:
        try:
            data = ai.get_notes_job(row.ai_job_id)
        except AIClientError as exc:
            logger.warning("ai poll(%s) failed: %s", row.ai_job_id, exc)
            continue
        if data is None:
            continue

        status = data.get("status")
        if status == "processing":
            with session_scope() as s:
                v = s.get(Video, row.id)
                if v is not None and v.ai_status != "processing":
                    v.ai_status = "processing"
                    v.updated_at = dt.datetime.now(dt.timezone.utc)
        elif status == "done":
            payload = {
                "transcript": data.get("transcript", ""),
                "summary": data.get("summary", ""),
                "key_topics": data.get("key_topics", []),
                "sections": data.get("sections", []),
                "mindmap": data.get("mindmap", ""),
            }
            with session_scope() as s:
                v = s.get(Video, row.id)
                if v is not None:
                    v.ai_status = "done"
                    v.notes_json = json.dumps(payload, ensure_ascii=False)
                    v.updated_at = dt.datetime.now(dt.timezone.utc)
            summary["ai_done"] += 1
        elif status == "failed":
            with session_scope() as s:
                v = s.get(Video, row.id)
                if v is not None:
                    v.ai_status = "failed"
                    v.updated_at = dt.datetime.now(dt.timezone.utc)


def _resolve_file_path(data: dict) -> Optional[str]:
    """Find a usable file path inside the Go core's video record.

    The shape varies across BBDown/yt-dlp/aria2 outputs; we look in the
    likely places. If the core didn't surface the path we fall back to
    deriving it from ``folder`` + ``name`` under ``STORAGE_PATH``.
    """
    for key in ("filePath", "file_path", "localPath", "local_path"):
        v = data.get(key)
        if v and isinstance(v, str):
            return v
    folder = data.get("folder") or ""
    name = data.get("name") or ""
    if name:
        candidate = os.path.join(STORAGE_PATH, folder, name) if folder else os.path.join(STORAGE_PATH, name)
        if os.path.exists(candidate):
            return candidate
        # The downloader probably appended an extension. Try looking it up.
        parent = os.path.join(STORAGE_PATH, folder) if folder else STORAGE_PATH
        if os.path.isdir(parent):
            for f in os.listdir(parent):
                if f.startswith(name):
                    return os.path.join(parent, f)
    return None
