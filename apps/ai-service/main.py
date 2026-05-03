"""MediaGo AI Service entry point.

Starts a FastAPI application on ``HOST:PORT`` (defaults 0.0.0.0:8899) with:

* ``/health``               — liveness/readiness probe
* ``/api/subtitle/*``       — FUNASR audio-to-text transcription
* ``/api/summarize/*``      — LM Studio video summarization

Environment variables are read from a ``.env`` file in the working directory
(if present) and from the process environment.

Usage
-----
::

    python main.py
    # or
    uvicorn main:app --host 0.0.0.0 --port 8899
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before importing anything that reads env vars.
load_dotenv()

from routers.health import router as health_router
from routers.notes import router as notes_router
from routers.subtitle import router as subtitle_router
from routers.summarize import router as summarize_router
from services.lmstudio_service import lmstudio_service

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan handler.

    Currently only logs startup/shutdown.  FUNASR model loading is deferred
    to the first inference call so startup is instant and GPU memory is not
    consumed unless the endpoint is actually used.
    """
    logger.info(
        "MediaGo AI Service starting — host=%s port=%s",
        os.getenv("HOST", "0.0.0.0"),
        os.getenv("PORT", "8899"),
    )
    logger.info(
        "GPU slots: %s | FUNASR model: %s | LM Studio: %s | LM model: %s | idle timeout: %ss",
        os.getenv("GPU_SLOTS", "2"),
        os.getenv("FUNASR_MODEL", "paraformer-zh"),
        os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"),
        os.getenv("LM_MODEL", "Qwen3.6-35B-A3B"),
        os.getenv("LM_IDLE_TIMEOUT", "3600"),
    )
    lmstudio_service.start_idle_watcher()
    yield
    lmstudio_service.stop_idle_watcher()
    logger.info("MediaGo AI Service shutting down.")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    """Build and return the configured FastAPI application."""
    app = FastAPI(
        title="MediaGo AI Service",
        description=(
            "Provides FUNASR-based subtitle transcription and "
            "LM Studio-based video summarization for the MediaGo SaaS platform."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS — allow all origins for internal service-to-service calls.
    # Tighten in production if this service is ever exposed externally.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    app.include_router(health_router)
    app.include_router(subtitle_router)
    app.include_router(summarize_router)
    app.include_router(notes_router)

    return app


app = create_app()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8899"))
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        log_level="info",
        # reload=True only makes sense in development; keep off by default.
        reload=False,
    )
