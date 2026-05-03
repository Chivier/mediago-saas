"""Source strategies — discover the latest videos for a creator.

Each source is a callable that takes a creator and yields normalized
``DiscoveredVideo`` records. ``get_source`` picks the right strategy
based on the creator's platform; failures fall back to a secondary
implementation (Selenium for Bilibili, yt-dlp for YouTube).
"""

from __future__ import annotations

from .base import DiscoveredVideo, SourceError
from .bilibili_api import BilibiliApiSource
from .bilibili_selenium import BilibiliSeleniumSource
from .youtube_rss import YoutubeRssSource
from .youtube_ytdlp import YoutubeYtdlpSource


__all__ = [
    "DiscoveredVideo",
    "SourceError",
    "fetch_latest",
    "resolve_bilibili_creator",
]


def fetch_latest(platform: str, external_id: str, *, max_pages: int = 5) -> list[DiscoveredVideo]:
    """Return the most recent videos a creator has uploaded.

    Falls back from primary → secondary on any ``SourceError``.
    """
    if platform == "bilibili":
        import logging as _log
        import os as _os
        api_error: SourceError | None = None
        try:
            videos = list(BilibiliApiSource().fetch(external_id, max_pages=max_pages))
            if videos:
                return videos
            api_error = SourceError("API returned no videos")
        except SourceError as exc:
            api_error = exc
            _log.getLogger(__name__).info(
                "bilibili API source failed for %s, falling back to Selenium: %s",
                external_id, exc,
            )

        sel_error: SourceError | None = None
        sel_videos: list[DiscoveredVideo] = []
        try:
            sel_videos = list(BilibiliSeleniumSource().fetch(external_id, max_pages=max_pages))
            if sel_videos:
                return sel_videos
            sel_error = SourceError("Selenium found no video cards (SPA failed to render — likely risk-control)")
        except SourceError as exc:
            sel_error = exc

        # Both came back empty / errored. Stitch a clear, actionable error.
        hint = (
            " — set BILI_SESSDATA in .env (cookie from a logged-in "
            "bilibili.com session) to bypass risk-control"
            if not _os.getenv("BILI_SESSDATA")
            else ""
        )
        raise SourceError(
            f"both Bilibili sources failed; api={api_error}; selenium={sel_error}{hint}"
        )
    if platform == "youtube":
        try:
            return list(YoutubeRssSource().fetch(external_id, max_pages=max_pages))
        except SourceError:
            return list(YoutubeYtdlpSource().fetch(external_id, max_pages=max_pages))
    raise SourceError(f"unknown platform: {platform}")


def resolve_bilibili_creator(name_or_mid: str) -> tuple[str, str]:
    """Given a name or numeric mid, return ``(mid, display_name)``.

    For numeric mids we hit the WBI API directly (fast). Free-text names
    require search.bilibili.com, which is captcha-locked anonymously, so
    we fall through to the Selenium-driven resolver for that case.
    """
    s = name_or_mid.strip()
    if s.isdigit():
        try:
            return BilibiliApiSource().resolve(s)
        except SourceError:
            pass
    return BilibiliSeleniumSource().resolve(s)
