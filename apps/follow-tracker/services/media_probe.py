"""Lightweight media-probing helpers.

Only one operation: ask ffprobe for the duration of a downloaded file.
Used by the poller to flag paid / preview videos — when BBDown only
gets a few minutes of an upload that B站 reports as 30+ minutes long,
that's a member-only / paid stream the cookie didn't unlock.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from typing import Optional


logger = logging.getLogger(__name__)


# Threshold: if downloaded duration is less than this fraction of the
# expected duration, mark the video as a paid preview. 0.6 leaves
# headroom for legit ad-stripping / pre-roll trimming differences while
# still catching the obvious "5min preview of a 30min lecture" case.
PAID_PREVIEW_RATIO = 0.6
# But always allow at least this much absolute slop — a few seconds of
# delta on a 30-second short shouldn't count as preview.
PAID_PREVIEW_MIN_DELTA_SEC = 90


def ffprobe_duration_seconds(path: str) -> Optional[float]:
    """Return the duration of the file in seconds, or None on any failure.

    Falls back to JSON output of streams when ``format=duration`` is
    missing (some BBDown intermediate containers expose duration only
    on the video stream).
    """
    if not path or not os.path.isfile(path):
        return None
    binary = shutil.which("ffprobe")
    if not binary:
        logger.debug("ffprobe not found; skipping duration probe")
        return None
    try:
        proc = subprocess.run(
            [
                binary,
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=duration",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        logger.warning("ffprobe failed for %s: %s", path, exc)
        return None
    try:
        data = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return None
    fmt = data.get("format") or {}
    if "duration" in fmt:
        try:
            return float(fmt["duration"])
        except (TypeError, ValueError):
            pass
    for s in data.get("streams") or []:
        if "duration" in s:
            try:
                return float(s["duration"])
            except (TypeError, ValueError):
                pass
    return None


def parse_expected_duration(raw: Optional[str]) -> Optional[int]:
    """Convert the duration string we stored at discovery time to seconds.

    Bilibili's API returns a numeric ``length`` like ``"32:08"`` or
    ``"1:02:14"``. YouTube RSS doesn't include duration (returns None).
    We accept both styles plus a bare integer (already-seconds).
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)
    # H:MM:SS or MM:SS
    if re.fullmatch(r"(\d+:)?\d+:\d+", s):
        parts = [int(p) for p in s.split(":")]
        if len(parts) == 2:
            return parts[0] * 60 + parts[1]
        if len(parts) == 3:
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return None


def is_likely_paid_preview(
    actual_seconds: Optional[float],
    expected_seconds: Optional[int],
) -> bool:
    """Return True when actual << expected by both ratio and absolute."""
    if not actual_seconds or not expected_seconds:
        return False
    if actual_seconds >= expected_seconds:
        return False
    if (expected_seconds - actual_seconds) < PAID_PREVIEW_MIN_DELTA_SEC:
        return False
    return (actual_seconds / expected_seconds) < PAID_PREVIEW_RATIO
