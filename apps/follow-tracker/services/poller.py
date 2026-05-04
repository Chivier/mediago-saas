"""Background poller.

For every video in ``status=queued`` with a ``download_id``, ask
mediago-core for the current download state. On ``success``, transition
to ``succeeded``, capture the file path, and (when ``AUTO_AI_PROCESSING``
is on) submit the file to the AI service for note generation.

Then, for every video sitting in ``ai_status in (pending, processing)``,
poll the AI service for completion and persist the JSON payload — and
write ``notes.md`` + ``transcript.txt`` next to the mp4 so the user can
browse them in the Files page without going through the API.

Designed to be called every ``DOWNLOAD_POLL_SECONDS`` from APScheduler.
A single tick runs in linear time over the small set of in-flight
videos; for thousands of subscriptions we'd batch the queries.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import shutil
from typing import Any, Optional

from sqlalchemy import select

from config import AUTO_AI_PROCESSING, STORAGE_PATH
from db import Video, session_scope

from .ai_client import AIClient, AIClientError
from .media_probe import (
    ffprobe_duration_seconds,
    is_likely_paid_preview,
    parse_expected_duration,
)
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
            job_id = ai.submit_notes(
                file_path=row.file_path, title=row.title, language="zh"
            )
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
            # Tidy: BBDown leaves an aid-named tmp dir under the work-dir
            # alongside the merged mp4; remove it so the Files page only
            # shows the user-facing video + notes.
            if file_path:
                _cleanup_temp_dirs(os.path.dirname(file_path))

            # Probe the file to spot paid-only videos that BBDown could
            # only grab a preview clip of.
            actual = ffprobe_duration_seconds(file_path) if file_path else None
            expected = parse_expected_duration(row.duration)
            paid = is_likely_paid_preview(actual, expected)

            with session_scope() as s:
                v = s.get(Video, row.id)
                if v is None:
                    continue
                v.status = "succeeded"
                v.file_path = file_path
                v.actual_duration_seconds = int(actual) if actual else None
                v.is_paid_preview = 1 if paid else 0
                v.updated_at = dt.datetime.now(dt.timezone.utc)
            if paid:
                logger.info(
                    "video %s flagged as paid-preview (actual=%.0fs vs expected=%ss)",
                    row.id, actual or 0, expected,
                )
            summary["promoted"] += 1

            if AUTO_AI_PROCESSING and file_path:
                try:
                    job_id = ai.submit_notes(
                        file_path=file_path, title=row.title, language="zh"
                    )
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
            # ai-service has no record of this job_id — almost always
            # means the service restarted (its job store is in-memory
            # only). Reset so the catch-up pass re-submits.
            logger.info(
                "ai job %s for video %s vanished; clearing for resubmit",
                row.ai_job_id, row.id,
            )
            with session_scope() as s:
                v = s.get(Video, row.id)
                if v is not None:
                    v.ai_status = None
                    v.ai_job_id = None
                    v.updated_at = dt.datetime.now(dt.timezone.utc)
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
                    # Persist to disk while we still have the row data —
                    # avoids re-fetching to write files.
                    file_path_snapshot = v.file_path
                    title_snapshot = v.title
            if file_path_snapshot:
                try:
                    _write_notes_files(file_path_snapshot, title_snapshot, payload)
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "wrote notes JSON to DB but disk write failed for video %s: %s",
                        row.id, exc,
                    )
            summary["ai_done"] += 1
        elif status == "failed":
            with session_scope() as s:
                v = s.get(Video, row.id)
                if v is not None:
                    v.ai_status = "failed"
                    v.updated_at = dt.datetime.now(dt.timezone.utc)


def _cleanup_temp_dirs(parent: str) -> None:
    """Remove BBDown's aid-named temp dirs that linger after a successful merge.

    BBDown writes ``<parent>/<aid>/*.vclip`` while downloading, then merges
    them into ``<parent>/<videoTitle>.mp4``. On a clean exit it removes the
    temp dir; on partial failures it leaves them, which clutters the Files
    page. We sweep any all-numeric subdirs of ``parent`` that look like
    that pattern.
    """
    if not parent or not os.path.isdir(parent):
        return
    try:
        for name in os.listdir(parent):
            if not name.isdigit():
                continue
            sub = os.path.join(parent, name)
            if not os.path.isdir(sub):
                continue
            # Confirm shape: contains only .vclip / .jpg / numeric files
            try:
                contents = os.listdir(sub)
            except OSError:
                continue
            if not contents:
                shutil.rmtree(sub, ignore_errors=True)
                continue
            ok = all(
                f.endswith((".vclip", ".jpg", ".aclip", ".m4s")) or f.startswith("0000")
                for f in contents
            )
            if ok:
                shutil.rmtree(sub, ignore_errors=True)
                logger.debug("cleaned BBDown temp dir: %s", sub)
    except OSError as exc:
        logger.warning("temp dir cleanup failed under %s: %s", parent, exc)


def _format_section(idx: int, section: dict[str, Any]) -> str:
    title = section.get("title") or f"Section {idx}"
    timestamp = section.get("timestamp")
    summary = section.get("summary")
    details = section.get("details")
    key_points = section.get("key_points") or []
    parts: list[str] = [f"### {idx}. {title}"]
    if timestamp:
        parts.append(f"_{timestamp}_")
    if summary:
        parts.append(summary)
    if details:
        parts.append(details)
    if key_points:
        parts.append("")
        parts.extend(f"- {p}" for p in key_points)
    return "\n\n".join(parts).strip()


def _render_notes_md(title: str, payload: dict[str, Any]) -> str:
    summary = payload.get("summary") or ""
    key_topics = payload.get("key_topics") or []
    sections = payload.get("sections") or []
    mindmap = (payload.get("mindmap") or "").strip()

    out: list[str] = [f"# {title}", ""]

    if summary:
        out.extend(["## 总结", "", summary, ""])

    if key_topics:
        out.append("## 核心主题")
        out.append("")
        out.extend(f"- {t}" for t in key_topics)
        out.append("")

    if sections:
        out.append("## 章节笔记")
        out.append("")
        for i, sec in enumerate(sections, 1):
            out.append(_format_section(i, sec))
            out.append("")

    if mindmap:
        out.append("## 思维导图")
        out.append("")
        out.append("```mermaid")
        out.append(mindmap)
        out.append("```")
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def _write_notes_files(file_path: str, title: str, payload: dict[str, Any]) -> None:
    """Drop ``notes.md`` + ``transcript.txt`` next to ``file_path``.

    Using fixed names (notes.md, transcript.txt) makes them easy to find
    and consistent across creators. The mp4's basename is preserved as-is
    in the same dir; users can delete the mp4 and keep the notes (which
    is exactly the workflow request — "有时候我们只存笔记就够用了").
    """
    parent = os.path.dirname(file_path)
    if not parent or not os.path.isdir(parent):
        # mp4 file disappeared (user deleted it?) — just bail
        logger.info("skipped notes write: parent dir missing for %s", file_path)
        return

    md_path = os.path.join(parent, "notes.md")
    transcript_path = os.path.join(parent, "transcript.txt")

    try:
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(_render_notes_md(title, payload))
    except OSError as exc:
        logger.warning("could not write %s: %s", md_path, exc)

    transcript = payload.get("transcript") or ""
    if transcript:
        try:
            with open(transcript_path, "w", encoding="utf-8") as f:
                f.write(transcript)
        except OSError as exc:
            logger.warning("could not write %s: %s", transcript_path, exc)


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
