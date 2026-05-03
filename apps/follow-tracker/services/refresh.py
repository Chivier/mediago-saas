"""Per-creator refresh: pull latest videos, persist new ones, optionally
queue them for download.

Used both by the scheduled job (every ``POLL_INTERVAL_HOURS``) and the
on-demand ``POST /api/creators/:id/refresh`` route.

The 10-consecutive-duplicates early-exit is borrowed from
bili-investigate: once we hit 10 already-known videos in a row we stop
walking the source, on the assumption that any older video must already
be in the DB.
"""

from __future__ import annotations

import datetime as dt
import logging
import time
from typing import TYPE_CHECKING

from db import Creator, Video, find_video, session_scope
from sources import fetch_latest

if TYPE_CHECKING:
    from .mediago_client import MediagoClient


logger = logging.getLogger(__name__)


CONSECUTIVE_DUPES_LIMIT = 10


def refresh_creator(creator_id: int, mediago: "MediagoClient | None" = None) -> dict:
    started = time.time()
    discovered = 0
    queued = 0
    error: str | None = None

    with session_scope() as s:
        c = s.get(Creator, creator_id)
        if c is None:
            return {
                "creator_id": creator_id,
                "discovered": 0,
                "queued": 0,
                "duration_seconds": 0.0,
                "error": "creator not found",
            }
        platform = c.platform
        external_id = c.external_id
        creator_name = c.name
        auto_download = bool(c.auto_download)
        cookies = c.cookies

    try:
        consecutive_dupes = 0
        for video in fetch_latest(platform, external_id, cookies=cookies):
            with session_scope() as s:
                existing = find_video(s, creator_id, video.external_id)
                if existing:
                    consecutive_dupes += 1
                    if consecutive_dupes >= CONSECUTIVE_DUPES_LIMIT:
                        logger.info(
                            "creator %s: hit %d consecutive duplicates, stopping",
                            creator_id,
                            CONSECUTIVE_DUPES_LIMIT,
                        )
                        break
                    continue
                consecutive_dupes = 0

                row = Video(
                    creator_id=creator_id,
                    external_id=video.external_id,
                    title=video.title,
                    url=video.url,
                    pub_date=video.pub_date,
                    duration=video.duration,
                    cover_url=video.cover_url,
                    status="discovered",
                )
                s.add(row)
                s.flush()
                video_db_id = row.id
            discovered += 1

            if auto_download and mediago is not None:
                try:
                    safe_title = safe_segment(video.title)
                    download_id = mediago.enqueue(
                        url=video.url,
                        download_type=_download_type_for(platform),
                        # name → BBDown's --file-pattern: just the title; with
                        # the per-video folder below this gives us
                        # /downloads/<creator>/<title>/<title>.{mp4,…}
                        name=safe_title,
                        # folder → BBDown's --work-dir suffix; we stash one
                        # level deep so the merged file, AI notes, transcript
                        # all live in the same per-video subdir.
                        folder=f"{safe_segment(creator_name)}/{safe_title}",
                        start=True,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("enqueue failed for video %s: %s", video.external_id, exc)
                    continue

                with session_scope() as s:
                    row = s.get(Video, video_db_id)
                    if row is not None:
                        row.status = "queued"
                        row.download_id = download_id
                queued += 1

    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
        logger.exception("refresh_creator(%s) failed", creator_id)

    duration = time.time() - started
    with session_scope() as s:
        c = s.get(Creator, creator_id)
        if c is not None:
            c.last_checked_at = dt.datetime.now(dt.timezone.utc)
            c.last_error = error

    return {
        "creator_id": creator_id,
        "discovered": discovered,
        "queued": queued,
        "duration_seconds": duration,
        "error": error,
    }


def _download_type_for(platform: str) -> str:
    if platform == "bilibili":
        return "bilibili"
    if platform == "youtube":
        return "youtube"
    raise ValueError(f"unsupported platform: {platform}")


def safe_segment(name: str) -> str:
    """Sanitize a single path segment (creator name OR video title).

    Strips characters that bork Linux/Windows filesystems, collapses
    slashes (so a single segment doesn't unexpectedly create subdirs),
    and caps length so the downloader has headroom for its own extension
    + temp file suffixes.
    """
    raw = (name or "").strip()
    bad = '<>:"\\|?*\n\r\t'
    out = "".join("_" if c in bad else c for c in raw)
    out = out.replace("/", "_")
    return out[:180] or "untitled"


# Backwards compat — older imports may still reference _safe_name. Now
# returns a single safe segment built from just the title (creator goes
# into the folder path, not the filename).
def _safe_name(creator: str, title: str) -> str:  # noqa: ARG001
    return safe_segment(title)
