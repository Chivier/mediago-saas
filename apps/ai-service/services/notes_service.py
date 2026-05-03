"""Rich notes generation: transcript → structured study notes + mindmap.

This is the heavier sibling of ``LMStudioService.summarize``. The
follow-tracker calls ``POST /api/notes/generate`` after a download
completes; we run FUNASR (or reuse a cached transcript), then ask the
LLM for a JSON document containing:

* ``summary``      — 2-3 paragraph overall summary
* ``key_topics``   — bullet list of major topics/themes
* ``sections``     — chronological walk-through with timestamps
* ``mindmap``      — Mermaid ``mindmap`` source for the admin-ui to render

The Ollama model behind LMStudioService handles inference; this module
just builds the right prompt and parses the JSON.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from models.schemas import SubtitleSegment
from services.gpu_manager import gpu_manager
from services.lmstudio_service import lmstudio_service


logger = logging.getLogger(__name__)


_NOTES_PROMPT_ZH = """\
你是一个视频内容分析助手。下面是一个视频的字幕转写，按时间顺序排列：

视频标题: {title}

字幕（[开始时间] 文本）:
{subtitle_text}

请基于这些内容生成一份详细的学习笔记，并以 JSON 格式输出。注意：
- summary 用 2-3 段话概括视频整体内容
- key_topics 列出 3-8 个核心主题
- sections 按视频章节切分，每节给出时间戳、标题、要点和 1-2 段详细内容
- mindmap 输出 Mermaid mindmap 语法（必须以 `mindmap` 行开头，使用 root((...)) 作为根节点，2 空格缩进表示层级）

只输出 JSON，不要 markdown 代码块包裹：

{{
  "summary": "...",
  "key_topics": ["...", "..."],
  "sections": [
    {{
      "title": "章节标题",
      "timestamp": "00:00 - 02:30",
      "summary": "本章节简介",
      "key_points": ["要点1", "要点2"],
      "details": "本章节的详细内容讲解"
    }}
  ],
  "mindmap": "mindmap\\n  root((视频主题))\\n    分支1\\n      子点1\\n      子点2\\n    分支2"
}}
"""


_NOTES_PROMPT_EN = """\
You are a video content analyst. Below is a chronological transcript of a video.

Title: {title}

Transcript ([start_time] text):
{subtitle_text}

Generate detailed study notes and output as a JSON document.
- summary: 2-3 paragraph overview
- key_topics: 3-8 core themes as a bullet list
- sections: chronological breakdown, each with timestamp, title, key points, and a paragraph of details
- mindmap: Mermaid mindmap syntax (must start with `mindmap`, use root((...)) as root, 2-space indent per level)

Output JSON only, no markdown fences:

{{
  "summary": "...",
  "key_topics": ["...", "..."],
  "sections": [
    {{
      "title": "section title",
      "timestamp": "00:00 - 02:30",
      "summary": "brief overview",
      "key_points": ["point 1", "point 2"],
      "details": "expanded explanation"
    }}
  ],
  "mindmap": "mindmap\\n  root((Topic))\\n    Branch 1\\n      Sub-point\\n    Branch 2"
}}
"""


_PROMPTS = {"zh": _NOTES_PROMPT_ZH, "en": _NOTES_PROMPT_EN}


def _format_timestamp(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _segments_to_prompt_text(segments: list[SubtitleSegment], max_chars: int = 30000) -> str:
    """Render segments as ``[hh:mm:ss] text`` lines, truncated to fit context.

    Models with a 32K context can typically handle ~25K chars of input
    plus a 1K-1.5K instruction. We truncate at the head of the transcript
    if needed so the *end* of the video isn't lost — for talks/lectures
    the conclusion tends to be more important than the warmup. (Most
    videos don't hit the cap.)
    """
    lines: list[str] = []
    total = 0
    # Build from the end so we can trim the head if needed.
    rendered = [f"[{_format_timestamp(seg.start)}] {seg.text}" for seg in segments]
    full = "\n".join(rendered)
    if len(full) <= max_chars:
        return full
    # Drop oldest lines until we fit.
    out: list[str] = []
    for line in reversed(rendered):
        if total + len(line) + 1 > max_chars:
            break
        out.append(line)
        total += len(line) + 1
    out.reverse()
    return "[…earlier transcript truncated…]\n" + "\n".join(out)


def _strip_code_fence(s: str) -> str:
    """Some models still wrap JSON in ```json ... ``` despite the instruction."""
    s = s.strip()
    if s.startswith("```"):
        # remove leading fence (```json or ```)
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        if s.endswith("```"):
            s = s[: -3]
        s = s.strip()
    return s


def _coerce_json(raw: str) -> dict[str, Any]:
    """Tolerantly parse a JSON document out of an LLM response.

    Strategy: strip code fences → try ``json.loads`` → on failure, locate
    the first ``{`` and matching ``}`` and try again. Returning a dict
    on the happy path; on hard failure we return a minimal stub with the
    raw text so the user at least sees something instead of an empty
    notes object.
    """
    cleaned = _strip_code_fence(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    if start >= 0:
        depth = 0
        for i in range(start, len(cleaned)):
            ch = cleaned[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = cleaned[start : i + 1]
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        break
    logger.warning("notes: LLM JSON parse failed, falling back to stub")
    return {"summary": cleaned[:2000], "key_topics": [], "sections": [], "mindmap": ""}


async def generate_notes(
    *,
    segments: list[SubtitleSegment],
    title: str | None,
    language: str = "zh",
) -> dict[str, Any]:
    """Run the LLM with a notes-generation prompt and return parsed JSON.

    Holds one GPU semaphore slot for the duration of inference (the
    transcribe step in the caller already released its slot). On any
    parse failure we still return a usable stub.
    """
    subtitle_text = _segments_to_prompt_text(segments)
    prompt = _PROMPTS.get(language, _NOTES_PROMPT_ZH).format(
        title=title or "(未提供)",
        subtitle_text=subtitle_text,
    )

    # Use the lmstudio_service's client + load handling — same model, same
    # GPU semaphore, just a different prompt.
    async with gpu_manager.acquire():
        await lmstudio_service._ensure_loaded()  # noqa: SLF001 — intentional reuse
        try:
            response = await lmstudio_service._client.chat.completions.create(  # noqa: SLF001
                model=lmstudio_service._model,  # noqa: SLF001
                messages=[{"role": "user", "content": prompt}],
                temperature=float(os.getenv("NOTES_TEMPERATURE", "0.3")),
                max_tokens=int(os.getenv("NOTES_MAX_TOKENS", "4096")),
            )
        except Exception as exc:
            logger.exception("notes: LLM call failed: %s", exc)
            raise RuntimeError(f"notes LLM error: {exc}") from exc

    import time as _time

    lmstudio_service._last_request = _time.monotonic()  # noqa: SLF001

    raw = response.choices[0].message.content or ""
    logger.debug("notes raw response (%d chars): %s…", len(raw), raw[:200])
    parsed = _coerce_json(raw)

    # Normalize fields so the admin-ui can render without surprises.
    return {
        "summary": str(parsed.get("summary", "")),
        "key_topics": list(parsed.get("key_topics", []) or []),
        "sections": list(parsed.get("sections", []) or []),
        "mindmap": str(parsed.get("mindmap", "")),
    }
