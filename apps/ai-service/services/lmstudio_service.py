"""LM Studio summarization service.

Uses the OpenAI Python client pointed at a local LM Studio instance
(``LMSTUDIO_BASE_URL``).  Every active request holds one slot on the
:data:`~services.gpu_manager.gpu_manager` semaphore because LM Studio
performs GPU inference internally.

Idle unload
-----------
If no requests arrive within ``LM_IDLE_TIMEOUT`` seconds (default 3600),
the service calls LM Studio's management API to unload the model and free
GPU memory.  The model is reloaded automatically on the next request.
Set ``LM_IDLE_TIMEOUT=0`` to disable the feature entirely.

LM Studio management endpoints used
-------------------------------------
* ``GET  /api/v0/models``         — check whether the model is loaded
* ``POST /api/v0/models/load``    — load model: ``{"identifier": "<id>"}``
* ``POST /api/v0/models/unload``  — unload model: ``{"identifier": "<id>"}``
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

import httpx
from openai import AsyncOpenAI

from models.schemas import SubtitleSegment
from services.gpu_manager import gpu_manager

logger = logging.getLogger(__name__)

_PROMPT_ZH = """\
你是一个专业的视频内容分析助手。以下是视频的字幕内容：

{subtitle_text}

请提供：
1. 视频内容摘要（200字以内）
2. 关键要点（3-5个bullet points）
3. 视频类型和主题

以JSON格式输出：{{"summary": "...", "key_points": ["...", "..."], "topic": "..."}}
"""

_PROMPT_EN = """\
You are a professional video content analysis assistant. Below are the video subtitles:

{subtitle_text}

Please provide:
1. A video content summary (under 200 words)
2. Key points (3-5 bullet points)
3. Video type and topic

Output as JSON: {{"summary": "...", "key_points": ["...", "..."], "topic": "..."}}
"""

_PROMPTS: dict[str, str] = {
    "zh": _PROMPT_ZH,
    "en": _PROMPT_EN,
}


def _segments_to_text(segments: list[SubtitleSegment]) -> str:
    return "\n".join(seg.text for seg in segments)


class LMStudioService:
    """Async wrapper around the LM Studio OpenAI-compatible API.

    Handles:
    * Inference via the ``/v1/chat/completions`` endpoint.
    * Idle-based model unloading / on-demand reloading via
      the ``/api/v0/models/*`` management endpoints.
    """

    # ── load/unload path prefix (relative to the management base) ──────────
    _MGMT_LOAD   = "/api/v0/models/load"
    _MGMT_UNLOAD = "/api/v0/models/unload"
    _MGMT_LIST   = "/api/v0/models"

    def __init__(self) -> None:
        v1_url: str = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")
        self._model: str = os.getenv("LM_MODEL", "Qwen3.6-35B-A3B")
        self._idle_timeout: int = int(os.getenv("LM_IDLE_TIMEOUT", "3600"))

        # OpenAI-compatible client for inference
        self._client = AsyncOpenAI(base_url=v1_url, api_key="lm-studio")

        # Management base URL: strip trailing /v1 (or /v1/) if present
        mgmt_base = v1_url.rstrip("/")
        if mgmt_base.endswith("/v1"):
            mgmt_base = mgmt_base[:-3]
        self._mgmt_base = mgmt_base

        # State tracking
        self._model_loaded: bool = False   # conservative: assume unloaded
        self._last_request: float = 0.0    # epoch seconds of last inference
        self._load_lock = asyncio.Lock()   # prevent concurrent load calls
        self._watcher_task: asyncio.Task[None] | None = None

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def start_idle_watcher(self) -> None:
        """Spawn the background idle-watcher coroutine.  Call once from lifespan."""
        if self._idle_timeout <= 0:
            logger.info("LM Studio idle-unload disabled (LM_IDLE_TIMEOUT=0).")
            return
        self._watcher_task = asyncio.create_task(
            self._idle_watcher_loop(), name="lmstudio-idle-watcher"
        )
        logger.info(
            "LM Studio idle-watcher started (timeout=%ds, model=%s).",
            self._idle_timeout,
            self._model,
        )

    def stop_idle_watcher(self) -> None:
        """Cancel the watcher task on shutdown."""
        if self._watcher_task and not self._watcher_task.done():
            self._watcher_task.cancel()

    # ── Public async API ───────────────────────────────────────────────────

    async def summarize(
        self,
        segments: list[SubtitleSegment],
        title: str | None = None,
        language: str = "zh",
    ) -> dict[str, Any]:
        """Summarize subtitle segments using the LLM.

        Automatically ensures the model is loaded before calling and
        updates the idle timestamp afterwards.
        """
        subtitle_text = _segments_to_text(segments)
        if title:
            prefix = f"视频标题: {title}\n\n" if language == "zh" else f"Video title: {title}\n\n"
            subtitle_text = prefix + subtitle_text

        prompt_template = _PROMPTS.get(language, _PROMPT_ZH)
        user_message = prompt_template.format(subtitle_text=subtitle_text)

        logger.info(
            "Calling LM Studio model '%s' for summarization (%d segments)…",
            self._model,
            len(segments),
        )

        # Hold GPU slot for the entire load+inference window
        async with gpu_manager.acquire():
            await self._ensure_loaded()
            try:
                response = await self._client.chat.completions.create(
                    model=self._model,
                    messages=[{"role": "user", "content": user_message}],
                    temperature=0.3,
                    max_tokens=1024,
                )
            except Exception as exc:
                logger.exception("LM Studio API error: %s", exc)
                raise RuntimeError(f"LM Studio API error: {exc}") from exc

        self._last_request = time.monotonic()
        raw_text: str = response.choices[0].message.content or ""
        logger.debug("LM Studio raw response: %s", raw_text[:300])
        return _parse_llm_response(raw_text)

    # ── Model management ───────────────────────────────────────────────────

    async def _ensure_loaded(self) -> None:
        """Load the model if it is not already loaded.  Thread-safe via a lock."""
        if self._model_loaded:
            return
        async with self._load_lock:
            # Re-check after acquiring lock (another coroutine may have loaded it)
            if self._model_loaded:
                return
            await self._load_model()

    async def _load_model(self) -> None:
        """Call LM Studio's load API and wait for the model to become available."""
        logger.info("Loading LM Studio model '%s'…", self._model)
        async with httpx.AsyncClient(timeout=300.0) as client:
            try:
                resp = await client.post(
                    f"{self._mgmt_base}{self._MGMT_LOAD}",
                    json={"identifier": self._model},
                )
                resp.raise_for_status()
                self._model_loaded = True
                logger.info("LM Studio model '%s' loaded.", self._model)
            except httpx.HTTPStatusError as exc:
                # 409 / similar can mean already loaded — treat as success
                if exc.response.status_code in (409, 200):
                    self._model_loaded = True
                    logger.info("Model already loaded (HTTP %d).", exc.response.status_code)
                else:
                    logger.error(
                        "Failed to load model '%s': HTTP %d — %s",
                        self._model,
                        exc.response.status_code,
                        exc.response.text[:200],
                    )
                    raise RuntimeError(f"Model load failed: {exc}") from exc
            except Exception as exc:
                logger.error("Failed to reach LM Studio management API: %s", exc)
                # If the management API is unavailable, try inference directly —
                # the model may already be loaded outside our tracking.
                self._model_loaded = True

    async def _unload_model(self) -> None:
        """Ask LM Studio to unload the model and release GPU memory."""
        logger.info(
            "Idle timeout reached — unloading LM Studio model '%s'.", self._model
        )
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                resp = await client.post(
                    f"{self._mgmt_base}{self._MGMT_UNLOAD}",
                    json={"identifier": self._model},
                )
                resp.raise_for_status()
                self._model_loaded = False
                logger.info("LM Studio model '%s' unloaded successfully.", self._model)
            except Exception as exc:
                # Non-fatal: log and mark as unloaded so we attempt a reload next time
                logger.warning(
                    "Failed to unload model '%s' (will still mark as unloaded): %s",
                    self._model,
                    exc,
                )
                self._model_loaded = False

    # ── Idle watcher ───────────────────────────────────────────────────────

    async def _idle_watcher_loop(self) -> None:
        """Check every 5 minutes whether the model has been idle too long."""
        check_interval = 300  # 5 minutes
        while True:
            await asyncio.sleep(check_interval)
            try:
                await self._check_idle()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Idle watcher error (non-fatal): %s", exc)

    async def _check_idle(self) -> None:
        if not self._model_loaded:
            return  # nothing to unload
        if self._last_request == 0.0:
            # Never served a request since startup — if model was pre-loaded
            # externally we don't touch it; only manage models we loaded ourselves.
            return
        idle_secs = time.monotonic() - self._last_request
        logger.debug(
            "LM Studio idle check: %.0fs idle (timeout=%ds)", idle_secs, self._idle_timeout
        )
        if idle_secs >= self._idle_timeout:
            await self._unload_model()


# Module-level singleton
lmstudio_service = LMStudioService()
