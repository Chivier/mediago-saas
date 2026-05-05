"""Cookie-resolution helpers — single place that knows the precedence
order between per-creator cookies, platform-level credentials, and the
legacy ``BILI_SESSDATA`` env var.

Precedence (most specific wins):

1. Explicit override the caller passed in (e.g. the cookie blob the user
   typed in the Add dialog).
2. ``Creator.cookies`` for the creator we're acting on.
3. ``PlatformCredential.cookies`` for that creator's platform.
4. ``BILI_SESSDATA`` env var for Bilibili (kept for backward compat with
   docker-compose setups that already wired this in).
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from db import PlatformCredential, session_scope


logger = logging.getLogger(__name__)


def platform_default_cookies(platform: str) -> Optional[str]:
    """Return the platform-wide cookie blob, or None if unset."""
    with session_scope() as s:
        row = s.get(PlatformCredential, platform)
        if row is not None and row.cookies:
            return row.cookies
    if platform == "bilibili":
        sessdata = os.getenv("BILI_SESSDATA")
        if sessdata:
            return f"SESSDATA={sessdata}"
    return None


def effective_cookies(
    *, platform: str, override: Optional[str] = None, creator_cookies: Optional[str] = None
) -> Optional[str]:
    """Resolve cookies for a single fetch using the documented precedence."""
    if override and override.strip():
        return override.strip()
    if creator_cookies and creator_cookies.strip():
        return creator_cookies.strip()
    return platform_default_cookies(platform)
