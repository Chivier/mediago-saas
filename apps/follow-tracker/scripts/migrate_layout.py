#!/usr/bin/env python3
"""One-shot migration to the per-video folder layout.

Walks every ``status=succeeded`` row, moves the mp4 from the old flat
location ``<creator>/<creator> - <title>.mp4`` into the new per-video
folder ``<creator>/<title>/<title>.mp4``, updates ``Video.file_path``,
writes ``notes.md`` + ``transcript.txt`` for any AI-completed jobs, and
removes any aid-named tmp dirs BBDown left behind.

Idempotent — safe to run repeatedly. Run inside the follow-tracker
container::

    docker compose exec mediago-follow python scripts/migrate_layout.py
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sys
from typing import Optional

# Importable when invoked from the container WORKDIR=/app.
sys.path.insert(0, "/app")

from sqlalchemy import select  # noqa: E402

from config import STORAGE_PATH  # noqa: E402
from db import Creator, Video, session_scope  # noqa: E402
from services.poller import (  # noqa: E402
    _cleanup_temp_dirs,
    _write_notes_files,
)
from services.refresh import safe_segment  # noqa: E402


logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("migrate")


def _expected_target(creator_name: str, title: str, current_ext: str = ".mp4") -> str:
    safe_creator = safe_segment(creator_name)
    safe_title = safe_segment(title)
    folder = os.path.join(STORAGE_PATH, safe_creator, safe_title)
    return os.path.join(folder, safe_title + current_ext)


def _move_file(src: str, dst: str) -> None:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(dst):
        if os.path.samefile(src, dst):
            return  # already where we want it
        log.warning("target already exists, skipping: %s", dst)
        return
    shutil.move(src, dst)
    log.info("moved → %s", os.path.relpath(dst, STORAGE_PATH))


def _migrate_one(video: Video, creator: Creator) -> Optional[str]:
    """Return new file_path on success, None if there's nothing to do."""
    current = video.file_path
    if not current or not os.path.exists(current):
        log.warning("video %s has no file at %s — skipping", video.id, current)
        return None

    expected = _expected_target(creator.name, video.title, os.path.splitext(current)[1])
    if os.path.realpath(current) == os.path.realpath(expected):
        return None

    _move_file(current, expected)
    return expected


def main() -> int:
    moves = 0
    notes_written = 0

    with session_scope() as s:
        rows = list(
            s.scalars(
                select(Video)
                .where(Video.status == "succeeded")
                .where(Video.file_path.is_not(None))
            )
        )
        creators_by_id = {c.id: c for c in s.scalars(select(Creator))}

    for v in rows:
        creator = creators_by_id.get(v.creator_id)
        if creator is None:
            log.warning("video %s has no creator (orphan) — skipping", v.id)
            continue
        new_path = _migrate_one(v, creator)
        if new_path:
            with session_scope() as s:
                fresh = s.get(Video, v.id)
                if fresh is not None:
                    fresh.file_path = new_path
            moves += 1

        # Whether or not the file moved, materialize notes if available
        # and not already on disk.
        target_path = new_path or v.file_path
        if not target_path:
            continue
        notes_dir = os.path.dirname(target_path)
        if v.ai_status == "done" and v.notes_json:
            md_path = os.path.join(notes_dir, "notes.md")
            if os.path.exists(md_path):
                continue
            try:
                payload = json.loads(v.notes_json)
            except json.JSONDecodeError:
                log.warning("video %s: notes_json is not valid JSON, skipping", v.id)
                continue
            try:
                _write_notes_files(target_path, v.title, payload)
                notes_written += 1
                log.info("wrote notes → %s", os.path.relpath(notes_dir, STORAGE_PATH))
            except Exception as exc:  # noqa: BLE001
                log.warning("video %s: write notes failed: %s", v.id, exc)

    # Sweep BBDown leftovers under each creator dir.
    for creator in creators_by_id.values():
        cdir = os.path.join(STORAGE_PATH, safe_segment(creator.name))
        _cleanup_temp_dirs(cdir)

    log.info("migrated %d files, wrote %d notes", moves, notes_written)
    return 0


if __name__ == "__main__":
    sys.exit(main())
