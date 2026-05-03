"""APScheduler wiring.

Two background jobs:

* refresh-all — runs every ``POLL_INTERVAL_HOURS`` and walks every
  creator, asking the source for any newly-uploaded videos. New ones get
  queued at mediago-core (when the creator has ``auto_download=true``).

* poll-downloads — runs every ``DOWNLOAD_POLL_SECONDS``, checking
  in-flight downloads + AI jobs and advancing their state.

Selenium is the bottleneck — one browser instance per refresh, and they
serialize because Chrome doesn't share well across threads. We use a
single-worker BackgroundScheduler so refreshes happen one creator at a
time. The poller runs alongside; it's HTTP-only and harmless.
"""

from __future__ import annotations

import datetime as dt
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select

from config import DOWNLOAD_POLL_SECONDS, POLL_INTERVAL_HOURS, RUN_AT_STARTUP
from db import Creator, session_scope

from .mediago_client import MediagoClient
from .poller import poll_once
from .refresh import refresh_creator


logger = logging.getLogger(__name__)


_scheduler: BackgroundScheduler | None = None


def _refresh_all() -> None:
    with session_scope() as s:
        creator_ids = list(s.scalars(select(Creator.id)))

    if not creator_ids:
        logger.info("refresh-all: no creators yet")
        return

    logger.info("refresh-all: %d creators", len(creator_ids))
    mediago = MediagoClient()
    try:
        for cid in creator_ids:
            try:
                summary = refresh_creator(cid, mediago=mediago)
                logger.info(
                    "refreshed creator %s: discovered=%s queued=%s err=%s",
                    cid,
                    summary["discovered"],
                    summary["queued"],
                    summary["error"],
                )
            except Exception:  # noqa: BLE001
                logger.exception("creator %s failed", cid)
    finally:
        mediago.close()


def _poll_tick() -> None:
    try:
        summary = poll_once()
        if any(summary.values()):
            logger.info("poller tick: %s", summary)
    except Exception:  # noqa: BLE001
        logger.exception("poller tick failed")


def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return

    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        _refresh_all,
        IntervalTrigger(hours=POLL_INTERVAL_HOURS),
        id="refresh-all",
        next_run_time=(
            dt.datetime.now(dt.timezone.utc) if RUN_AT_STARTUP else None
        ),
        max_instances=1,
        coalesce=True,
    )
    _scheduler.add_job(
        _poll_tick,
        IntervalTrigger(seconds=DOWNLOAD_POLL_SECONDS),
        id="poll-downloads",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    logger.info(
        "scheduler started: refresh every %sh, poll every %ss",
        POLL_INTERVAL_HOURS,
        DOWNLOAD_POLL_SECONDS,
    )


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
