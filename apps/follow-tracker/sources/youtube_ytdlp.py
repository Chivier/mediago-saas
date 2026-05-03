"""YouTube fallback — yt-dlp ``--flat-playlist`` over a channel URL.

Used when the RSS feed comes up empty (the 15-video cap or member-only
content). Slower than RSS (one yt-dlp invocation hits the YouTube
frontend) but covers the long tail.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from typing import Iterator

from .base import DiscoveredVideo, SourceError


logger = logging.getLogger(__name__)


CHANNEL_VIDEOS_URL = "https://www.youtube.com/channel/{cid}/videos"


class YoutubeYtdlpSource:
    def fetch(self, channel_id: str, *, max_pages: int = 5) -> Iterator[DiscoveredVideo]:
        binary = shutil.which("yt-dlp")
        if not binary:
            raise SourceError("yt-dlp not found in $PATH")

        # max_pages × 30 is a reasonable proxy for a "page" worth of
        # content. yt-dlp doesn't paginate per-se; --playlist-end caps the
        # number of items we ask for.
        playlist_end = max(15, max_pages * 30)

        cmd = [
            binary,
            "--flat-playlist",
            "--dump-single-json",
            "--no-warnings",
            "--playlist-end",
            str(playlist_end),
            CHANNEL_VIDEOS_URL.format(cid=channel_id),
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=180,
                check=True,
            )
        except subprocess.TimeoutExpired as exc:
            raise SourceError(f"yt-dlp timed out for {channel_id}") from exc
        except subprocess.CalledProcessError as exc:
            raise SourceError(f"yt-dlp failed: {exc.stderr.strip()[:200]}") from exc

        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise SourceError(f"yt-dlp returned non-JSON: {exc}") from exc

        for entry in data.get("entries") or []:
            vid = entry.get("id")
            if not vid:
                continue
            yield DiscoveredVideo(
                external_id=vid,
                title=entry.get("title") or "(untitled)",
                url=entry.get("url") or f"https://www.youtube.com/watch?v={vid}",
                pub_date=entry.get("upload_date"),
                duration=str(entry["duration"]) if entry.get("duration") else None,
                cover_url=(entry.get("thumbnails") or [{}])[-1].get("url"),
            )
