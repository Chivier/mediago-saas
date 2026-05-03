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
