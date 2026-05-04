"""FastAPI entry point.

Exposes ``/api/creators`` (CRUD), ``/api/videos`` and
``/api/creators/:id/videos`` (read + manual queue/skip), and
``/health``. Boots the APScheduler that handles periodic refresh + the
download/AI poller.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import init_db
from routers import bili_login, creators, health, platform_logins, videos
from seed import maybe_bootstrap
from services import scheduler


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger("follow-tracker")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    # Selenium-driven seed resolution can take 30s+ per name. Run it in a
    # thread so it doesn't block the event loop / our health endpoint.
    import asyncio
    asyncio.create_task(asyncio.to_thread(maybe_bootstrap))
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown()


app = FastAPI(title="MediaGo Follow Tracker", version="0.1.0", lifespan=lifespan)

# Internal-network access only (admin nginx is the public face), but we
# CORS-allow everything because the dev workflow hits this directly from
# localhost too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(creators.router, prefix="/api")
app.include_router(videos.router, prefix="/api")
app.include_router(bili_login.router, prefix="/api")
app.include_router(platform_logins.router, prefix="/api")


@app.get("/")
def root() -> dict:
    return {"service": "follow-tracker", "version": app.version}
