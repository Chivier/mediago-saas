#!/usr/bin/env python3
"""Re-run the GPT-5.4 polish step on every notes_json that hasn't been
polished yet (or that the operator wants to re-polish).

This is a follow-tracker-side script — the canonical source of truth
for "what notes exist" lives in follow-tracker's SQLite, not the
ai-service's in-memory job store. The script reads each row's
``notes_json`` + ``transcript`` fields, calls the polish service, and
rewrites the JSON blob plus the on-disk ``notes.md``.

Run inside the follow-tracker container so we share its DB volume::

    docker compose exec mediago-follow python /app/scripts/repolish.py
    docker compose exec mediago-follow python /app/scripts/repolish.py --force
    docker compose exec mediago-follow python /app/scripts/repolish.py --limit 10

Lives under apps/ai-service/scripts because the polish prompt + endpoint
config live there; copied into the follow-tracker image at build time
via a relative import (or, simpler, executed via the ai-service's
HTTP endpoint — but a local import keeps the loop fast).

In practice we ship this script in apps/ai-service AND mount it into
the follow-tracker so the same code runs in either place.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from typing import Any


sys.path.insert(0, "/app")

# Reach into the follow-tracker DB.
from db import Video, session_scope  # noqa: E402
from sqlalchemy import select  # noqa: E402

# Polish service is shipped to /app/services/polish_service.py inside
# the follow-tracker image (mounted from apps/ai-service/services).
from services.polish_service import is_enabled, polish  # noqa: E402
from services.poller import _write_notes_files  # noqa: E402


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("repolish")


async def repolish_one(video: Video, force: bool) -> tuple[bool, str]:
    if not video.notes_json:
        return False, "no notes_json"
    try:
        notes = json.loads(video.notes_json)
    except json.JSONDecodeError as exc:
        return False, f"notes_json malformed: {exc}"
    if notes.get("polished") and not force:
        return False, "already polished"

    transcript = notes.get("transcript") or ""
    if not transcript.strip():
        return False, "no transcript"

    polished = await polish(
        title=video.title,
        transcript=transcript,
        notes={
            "summary": notes.get("summary", ""),
            "key_topics": notes.get("key_topics", []),
            "sections": notes.get("sections", []),
            "mindmap": notes.get("mindmap", ""),
        },
    )
    if not polished.get("polished"):
        return False, "polish returned unchanged (API failed?)"

    new_notes: dict[str, Any] = {
        "transcript": transcript,
        "summary": polished.get("summary", notes.get("summary", "")),
        "key_topics": polished.get("key_topics", notes.get("key_topics", [])),
        "sections": polished.get("sections", notes.get("sections", [])),
        "mindmap": polished.get("mindmap", notes.get("mindmap", "")),
        "entities": polished.get("entities", {}),
        "polished": True,
    }
    if polished.get("polish_notes"):
        new_notes["polish_notes"] = polished["polish_notes"]

    with session_scope() as s:
        v = s.get(Video, video.id)
        if v is None:
            return False, "row vanished"
        v.notes_json = json.dumps(new_notes, ensure_ascii=False)

    if video.file_path:
        try:
            _write_notes_files(video.file_path, video.title, new_notes)
        except Exception as exc:  # noqa: BLE001
            log.warning("video %s: disk rewrite failed: %s", video.id, exc)
    return True, "ok"


async def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--force", action="store_true", help="re-polish even if already polished")
    p.add_argument("--limit", type=int, default=0, help="cap number of rows (0 = unlimited)")
    p.add_argument("--id", type=int, default=None, help="repolish a single video by id")
    args = p.parse_args()

    if not is_enabled():
        log.error("POLISH_API_KEY not set; nothing to do")
        return 2

    with session_scope() as s:
        q = select(Video).where(Video.notes_json.is_not(None))
        if args.id is not None:
            q = q.where(Video.id == args.id)
        rows = list(s.scalars(q.order_by(Video.id)))

    if args.limit:
        rows = rows[: args.limit]
    log.info("considering %d video(s)", len(rows))

    polished = 0
    skipped = 0
    failed = 0
    for v in rows:
        ok, why = await repolish_one(v, args.force)
        if ok:
            polished += 1
            log.info("[%d] %s — polished", v.id, v.title[:60])
        else:
            if "already polished" in why:
                skipped += 1
            else:
                failed += 1
                log.warning("[%d] %s — %s", v.id, v.title[:60], why)
    log.info("done: polished=%d skipped=%d failed=%d", polished, skipped, failed)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
