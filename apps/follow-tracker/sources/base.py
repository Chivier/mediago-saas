"""Common types for all source implementations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


class SourceError(Exception):
    """Raised when a source can't fetch — caller should consider falling back."""


@dataclass
class DiscoveredVideo:
    """One video as the source surfaced it. The DB record is built from this."""

    external_id: str
    title: str
    url: str
    pub_date: Optional[str] = None
    duration: Optional[str] = None
    cover_url: Optional[str] = None


def parse_cookies(raw: Optional[str]) -> dict[str, str]:
    """Parse the cookie blob a user pasted from browser DevTools.

    Accepts the standard ``Cookie:`` header form ``k1=v1; k2=v2`` (newlines
    are also tolerated since pasting from DevTools sometimes wraps). Empty
    or missing input returns an empty dict so callers can do
    ``cookies = parse_cookies(creator.cookies) or {}`` without guarding.

    Values are taken verbatim — Bilibili stores URL-encoded ``%2C`` and the
    like in ``SESSDATA`` and re-encoding would invalidate the signature.
    """
    if not raw:
        return {}
    out: dict[str, str] = {}
    # Split on both ; and newline so multi-line paste-from-browser works.
    for part in raw.replace("\n", ";").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        k = k.strip()
        v = v.strip()
        if k:
            out[k] = v
    return out
