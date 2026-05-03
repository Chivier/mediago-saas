"""Runtime config — all knobs come from env vars so docker-compose is the
single source of truth and we never bake host-specific paths into the image."""

from __future__ import annotations

import os
from pathlib import Path


PORT: int = int(os.getenv("PORT", "8900"))

# Where mediago-core lives on the docker network. The follow-tracker POSTs
# new videos here to enqueue downloads, and polls /api/downloads/:id to
# notice when a download has finished so we can fire off the AI pipeline.
MEDIAGO_BASE_URL: str = os.getenv("MEDIAGO_BASE_URL", "http://mediago-core:8080")

# Where the AI service lives. Used for transcript+notes generation after
# a download completes.
AI_BASE_URL: str = os.getenv("AI_BASE_URL", "http://mediago-ai:8899")

# Where downloaded files actually land on disk. The Go core writes there;
# we read the same mount so the AI service has a path it can stat.
STORAGE_PATH: str = os.getenv("STORAGE_PATH", "/downloads")

# Persistent state — SQLite DB.
DATA_DIR: Path = Path(os.getenv("DATA_DIR", "/data"))
DB_PATH: str = os.getenv("DB_PATH", str(DATA_DIR / "follow.db"))

# Polling cadence for the scheduled refresh of every creator's video list.
POLL_INTERVAL_HOURS: float = float(os.getenv("POLL_INTERVAL_HOURS", "6"))

# How often the post-download poller checks mediago-core for finished
# downloads (and the AI service for finished note jobs). Short interval
# is fine because both endpoints are cheap JSON queries.
DOWNLOAD_POLL_SECONDS: int = int(os.getenv("DOWNLOAD_POLL_SECONDS", "60"))

# Max number of pages of a creator's space to crawl per refresh. After the
# first crawl this is largely moot because the early-exit on 10 consecutive
# duplicates kicks in before we'd hit it.
MAX_PAGES_PER_CREATOR: int = int(os.getenv("MAX_PAGES_PER_CREATOR", "5"))

# Selenium chromedriver path — apt-installed at /usr/local/bin/chromedriver
# inside the container.
CHROMEDRIVER_PATH: str = os.getenv("CHROMEDRIVER_PATH", "/usr/local/bin/chromedriver")

# When true, scheduled refresh runs at startup. Off by default so booting
# the service in dev doesn't fan out to 10 Selenium browsers immediately.
RUN_AT_STARTUP: bool = os.getenv("RUN_AT_STARTUP", "false").lower() in {"1", "true", "yes"}

# Auto-trigger AI notes generation after a download completes for
# creators with auto_download=true. Set false to defer to manual trigger.
AUTO_AI_PROCESSING: bool = os.getenv("AUTO_AI_PROCESSING", "true").lower() in {"1", "true", "yes"}

DATA_DIR.mkdir(parents=True, exist_ok=True)
