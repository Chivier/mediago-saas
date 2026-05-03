"""YouTube source via the public per-channel Atom feed.

Hits ``/feeds/videos.xml?channel_id=...``, no auth, no rate limit, returns
the latest 15 videos. Matches what RSS readers and Hypefury et al use.
The 15-video cap is YouTube's; for the very long tail we'd need yt-dlp
(``YoutubeYtdlpSource``).
"""

from __future__ import annotations

import logging
from typing import Iterator

import feedparser
import httpx

from .base import DiscoveredVideo, SourceError


logger = logging.getLogger(__name__)


FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={cid}"
WATCH_URL = "https://www.youtube.com/watch?v={vid}"


class YoutubeRssSource:
    def fetch(self, channel_id: str, *, max_pages: int = 5) -> Iterator[DiscoveredVideo]:
        # max_pages is meaningless for RSS (always one page of 15) — kept
        # in the signature so callers don't need to special-case sources.
        del max_pages

        url = FEED_URL.format(cid=channel_id)
        try:
            r = httpx.get(url, timeout=15, follow_redirects=True)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise SourceError(f"YouTube RSS fetch failed: {exc}") from exc

        feed = feedparser.parse(r.text)
        if feed.bozo and not feed.entries:
            raise SourceError(f"YouTube RSS unparseable for channel {channel_id}")

        for entry in feed.entries:
            # entry.yt_videoid is the canonical 11-char video id; fall back
            # to parsing the link if the namespace prefix gets lost in
            # transit.
            vid = getattr(entry, "yt_videoid", None) or _vid_from_link(entry.get("link", ""))
            if not vid:
                continue
            cover = None
            thumb = entry.get("media_thumbnail")
            if thumb and isinstance(thumb, list) and thumb:
                cover = thumb[0].get("url")
            yield DiscoveredVideo(
                external_id=vid,
                title=entry.get("title", "(untitled)"),
                url=WATCH_URL.format(vid=vid),
                pub_date=entry.get("published"),
                duration=None,  # not in RSS
                cover_url=cover,
            )


def _vid_from_link(link: str) -> str | None:
    if "watch?v=" in link:
        tail = link.split("watch?v=", 1)[1]
        return tail.split("&", 1)[0] or None
    return None
