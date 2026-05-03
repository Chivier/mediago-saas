"""FUNASR ASR service with lazy model loading.

The :class:`FunASRService` wraps the ``funasr.AutoModel`` and provides an
async interface.  The model is loaded on the first call to
:meth:`transcribe` (lazy initialisation) to avoid occupying GPU memory at
process startup.

Model selection
---------------
The model is chosen based on the ``FUNASR_MODEL`` env var (default
``paraformer-zh``).  The caller may also pass a *language* hint:

* ``"zh"``   → ``paraformer-zh``
* ``"en"``   → ``paraformer-en``
* ``"auto"`` → uses whatever ``FUNASR_MODEL`` is configured

GPU access is serialised through :data:`~services.gpu_manager.gpu_manager`.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path
from typing import Any

from models.schemas import SubtitleSegment
from services.audio_extractor import extract_audio
from services.gpu_manager import gpu_manager

logger = logging.getLogger(__name__)

_MODEL_MAP: dict[str, str] = {
    "zh": "paraformer-zh",
    "en": "paraformer-en",
    "auto": "paraformer-zh",  # default to zh for auto detection
}


class FunASRService:
    """Lazy-loading wrapper around ``funasr.AutoModel``.

    The underlying model is initialised in a background thread on the first
    call to :meth:`transcribe` so that startup latency is zero and GPU memory
    is only consumed when the model is actually needed.
    """

    def __init__(self) -> None:
        self._model: Any | None = None
        self._model_name: str = os.getenv("FUNASR_MODEL", "paraformer-zh")
        self._device: str = os.getenv("FUNASR_DEVICE", "cuda")
        self._init_lock: asyncio.Lock = asyncio.Lock()
        self._loaded: bool = False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_model_sync(self) -> None:
        """Blocking model initialisation — runs inside a thread pool."""
        from funasr import AutoModel  # type: ignore[import]

        logger.info("Loading FUNASR model '%s' on device '%s'…", self._model_name, self._device)
        self._model = AutoModel(
            model=self._model_name,
            vad_model="fsmn-vad",
            punc_model="ct-punc",
            device=self._device,
            ncpu=4,
        )
        self._loaded = True
        logger.info("FUNASR model loaded successfully.")

    async def _ensure_model(self) -> None:
        """Ensure the model is loaded exactly once, even under concurrency."""
        if self._loaded:
            return
        async with self._init_lock:
            if self._loaded:
                return
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._load_model_sync)

    def _run_inference_sync(self, audio_path: str) -> list[dict[str, Any]]:
        """Run FUNASR inference synchronously — called from a thread pool."""
        assert self._model is not None, "Model must be loaded before inference"
        logger.info("Running FUNASR inference on: %s", audio_path)
        results: list[dict[str, Any]] = self._model.generate(
            input=audio_path,
            batch_size_s=300,
        )
        return results

    # ------------------------------------------------------------------
    # Public async API
    # ------------------------------------------------------------------

    async def transcribe(self, file_path: str, language: str = "auto") -> list[SubtitleSegment]:
        """Transcribe a video or audio file and return timestamped segments.

        Parameters
        ----------
        file_path:
            Absolute path to the video/audio file.
        language:
            ``"zh"``, ``"en"``, or ``"auto"``.  Controls which model variant
            is used when ``FUNASR_MODEL`` is set to ``"auto"``.

        Returns
        -------
        list[SubtitleSegment]
            Ordered list of subtitle segments.

        Raises
        ------
        FileNotFoundError
            If *file_path* does not exist.
        RuntimeError
            If FUNASR inference fails.
        """
        if not Path(file_path).exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        # Override the model name based on the language hint when the user
        # has set FUNASR_MODEL to a language-neutral value.
        if language in _MODEL_MAP and language != "auto":
            self._model_name = _MODEL_MAP[language]

        async with gpu_manager.acquire():
            # Ensure model is loaded (holds the GPU slot during load too so
            # we don't try to load while already at capacity).
            await self._ensure_model()

            # Extract audio in the same GPU slot acquisition so we don't
            # release between extract and infer.
            wav_path: str | None = None
            try:
                wav_path = await extract_audio(file_path)
                loop = asyncio.get_running_loop()
                raw_results = await loop.run_in_executor(
                    None, self._run_inference_sync, wav_path
                )
            finally:
                if wav_path is not None:
                    try:
                        os.unlink(wav_path)
                    except OSError:
                        pass

        return _parse_funasr_results(raw_results)


def _parse_funasr_results(raw: list[dict[str, Any]]) -> list[SubtitleSegment]:
    """Convert raw FUNASR output into :class:`SubtitleSegment` objects.

    FUNASR returns a list of dicts.  Each dict may contain a ``"timestamp"``
    key (list of ``[start_ms, end_ms]`` pairs, one per token) and a
    ``"text"`` key.  When ``vad_model`` is active the outer list represents
    VAD segments, each with its own timestamps.

    We attempt to reconstruct utterance-level segments from the token-level
    timestamps if available, otherwise we fall back to assigning a synthetic
    duration based on character count.
    """
    segments: list[SubtitleSegment] = []

    for item in raw:
        text: str = (item.get("text") or "").strip()
        if not text:
            continue

        timestamps: list[list[float]] | None = item.get("timestamp")

        if timestamps and len(timestamps) >= 2:
            # Token-level timestamps: [[start_ms, end_ms], ...]
            start_ms = timestamps[0][0]
            end_ms = timestamps[-1][1]
            segments.append(
                SubtitleSegment(
                    start=round(start_ms / 1000.0, 3),
                    end=round(end_ms / 1000.0, 3),
                    text=text,
                )
            )
        else:
            # Fallback: position after the previous segment + ~1s/5 chars
            prev_end = segments[-1].end if segments else 0.0
            duration = max(1.0, len(text) / 5.0)
            segments.append(
                SubtitleSegment(
                    start=round(prev_end, 3),
                    end=round(prev_end + duration, 3),
                    text=text,
                )
            )

    return segments


def build_srt(segments: list[SubtitleSegment]) -> str:
    """Render a list of :class:`SubtitleSegment` objects as SRT text.

    Parameters
    ----------
    segments:
        Ordered subtitle segments.

    Returns
    -------
    str
        Well-formed SubRip (.srt) formatted string.
    """
    lines: list[str] = []
    for idx, seg in enumerate(segments, start=1):
        lines.append(str(idx))
        lines.append(f"{_fmt_srt_time(seg.start)} --> {_fmt_srt_time(seg.end)}")
        lines.append(seg.text)
        lines.append("")  # blank line between entries
    return "\n".join(lines)


def _fmt_srt_time(seconds: float) -> str:
    """Format *seconds* as ``HH:MM:SS,mmm`` (SRT timestamp format)."""
    millis = int(round(seconds * 1000))
    hh = millis // 3_600_000
    millis %= 3_600_000
    mm = millis // 60_000
    millis %= 60_000
    ss = millis // 1_000
    ms = millis % 1_000
    return f"{hh:02d}:{mm:02d}:{ss:02d},{ms:03d}"


# Module-level singleton
funasr_service = FunASRService()
