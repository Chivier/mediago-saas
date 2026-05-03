"""Seed-list bootstrap.

On startup, if the creators table is empty AND ``seed/creators.json``
exists, walk the list and insert each entry. mids that aren't supplied
get resolved via Selenium search (slow but one-time). Failures are
logged + recorded as ``last_error`` on the partial creator row so the
UI surfaces them instead of silently skipping.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

from sqlalchemy import func, select

from db import Creator, session_scope
from sources import resolve_bilibili_creator
from sources.base import SourceError


logger = logging.getLogger(__name__)


SEED_FILE = Path(__file__).parent / "creators.json"


def maybe_bootstrap() -> None:
    if not SEED_FILE.exists():
        return

    with session_scope() as s:
        existing = s.scalar(select(func.count(Creator.id))) or 0
    if existing > 0:
        logger.info("seed: %d creators already present, skipping bootstrap", existing)
        return

    try:
        data = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        logger.error("seed: malformed JSON in %s: %s", SEED_FILE, exc)
        return

    entries = data.get("creators") or []
    if not entries:
        return

    logger.info("seed: bootstrapping %d creators", len(entries))
    for entry in entries:
        platform = entry.get("platform")
        name = (entry.get("name") or "").strip()
        external_id = (entry.get("mid") or entry.get("external_id") or "").strip()
        auto_download = bool(entry.get("auto_download", True))

        try:
            if platform == "bilibili":
                lookup = external_id or name
                if not lookup:
                    raise SourceError("seed entry missing both name and mid")
                if not external_id:
                    mid, resolved_name = resolve_bilibili_creator(lookup)
                    external_id = mid
                    if not name:
                        name = resolved_name
                else:
                    if not name:
                        # accept the mid as a placeholder name; user can rename
                        name = f"User_{external_id}"
            elif platform == "youtube":
                if not external_id:
                    raise SourceError("seed YouTube entry missing channel_id")
                if not name:
                    name = external_id
            else:
                raise SourceError(f"unknown platform: {platform}")

            with session_scope() as s:
                # Race-safe: skip if a duplicate snuck in (e.g. concurrent boot).
                already = s.scalars(
                    select(Creator).where(
                        Creator.platform == platform,
                        Creator.external_id == external_id,
                    )
                ).first()
                if already is not None:
                    continue
                s.add(
                    Creator(
                        platform=platform,
                        external_id=external_id,
                        name=name,
                        auto_download=1 if auto_download else 0,
                    )
                )
            logger.info("seed: added %s/%s (%s)", platform, name, external_id)
        except SourceError as exc:
            logger.warning("seed: skipping '%s': %s", name or external_id, exc)
            # Still record a stub row so the UI shows the user that we
            # tried, with the error visible. Use a unique-ish placeholder
            # external_id so the unique-pair invariant still holds.
            placeholder = f"unresolved-{name}-{dt.datetime.utcnow().timestamp():.0f}"
            with session_scope() as s:
                s.add(
                    Creator(
                        platform=platform or "bilibili",
                        external_id=placeholder,
                        name=name or placeholder,
                        auto_download=0,
                        last_error=str(exc),
                    )
                )
        except Exception as exc:  # noqa: BLE001
            logger.exception("seed: unexpected error for '%s'", name or external_id)
