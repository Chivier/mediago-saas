"""LM Studio summarization service.

Uses the OpenAI Python client pointed at a local LM Studio instance
(``LMSTUDIO_BASE_URL``).  Every active request holds one slot on the
:data:`~services.gpu_manager.gpu_manager` semaphore because LM Studio
performs GPU inference internally.

Prompt
------
The default prompt asks the model to return a JSON object with three keys:
``summary``, ``key_points`` (list), and ``topic``.  The response is parsed
with ``json.loads``; if parsing fails the raw text is stored in ``summary``.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

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
    """Flatten subtitle segments into a plain text transcript."""
    return "\n".join(seg.text for seg in segments)


class LMStudioService:
    """Async wrapper around the LM Studio OpenAI-compatible API.

    Parameters
    ----------
    base_url:
        LM Studio API base URL.  Reads ``LMSTUDIO_BASE_URL`` env var.
    model:
        Model identifier to use.  Reads ``LM_MODEL`` env var.
    """

    def __init__(self) -> None:
        self._base_url: str = os.getenv(
            "LMSTUDIO_BASE_URL", "http://localhost:1234/v1"
        )
        self._model: str = os.getenv("LM_MODEL", "Qwen3.6-35B-A3B")
        self._client: AsyncOpenAI = AsyncOpenAI(
            base_url=self._base_url,
            api_key="lm-studio",  # LM Studio ignores the key value
        )

    # ------------------------------------------------------------------
    # Public async API
    # ------------------------------------------------------------------

    async def summarize(
        self,
        segments: list[SubtitleSegment],
        title: str | None = None,
        language: str = "zh",
    ) -> dict[str, Any]:
        """Summarize a list of subtitle segments using the LLM.

        Parameters
        ----------
        segments:
            Ordered subtitle segments (the transcript source).
        title:
            Optional video title prepended to the transcript.
        language:
            Output language — ``"zh"`` (default) or ``"en"``.

        Returns
        -------
        dict
            Keys: ``summary`` (str), ``key_points`` (list[str]), ``topic`` (str).

        Raises
        ------
        RuntimeError
            If the LM Studio API call fails.
        """
        subtitle_text = _segments_to_text(segments)
        if title:
            subtitle_text = f"视频标题: {title}\n\n{subtitle_text}" if language == "zh" else f"Video title: {title}\n\n{subtitle_text}"

        prompt_template = _PROMPTS.get(language, _PROMPT_ZH)
        user_message = prompt_template.format(subtitle_text=subtitle_text)

        logger.info(
            "Calling LM Studio model '%s' for summarization (%d segments)…",
            self._model,
            len(segments),
        )

        async with gpu_manager.acquire():
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

        raw_text: str = response.choices[0].message.content or ""
        logger.debug("LM Studio raw response: %s", raw_text[:300])

        return _parse_llm_response(raw_text)


def _parse_llm_response(text: str) -> dict[str, Any]:
    """Extract structured data from the LLM text response.

    Attempts to parse JSON.  If the model wrapped the JSON in a markdown
    code block we strip the fences first.  Falls back to returning the
    raw text in the ``summary`` field if JSON parsing fails entirely.
    """
    # Strip markdown code fences if present
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        # Drop first line (```json or ```) and last line (```)
        cleaned = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    # Find the outermost JSON object
    start = cleaned.find("{")
    end = cleaned.rfind("}") + 1
    if start != -1 and end > start:
        json_str = cleaned[start:end]
        try:
            data = json.loads(json_str)
            return {
                "summary": str(data.get("summary", "")),
                "key_points": [str(p) for p in data.get("key_points", [])],
                "topic": str(data.get("topic", "")),
            }
        except json.JSONDecodeError:
            logger.warning("Failed to parse LLM JSON response; storing raw text.")

    return {
        "summary": text.strip(),
        "key_points": [],
        "topic": "",
    }


# Module-level singleton
lmstudio_service = LMStudioService()
