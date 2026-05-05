"""Final-pass notes polishing via an external GPT-5.4 endpoint.

The local Ollama qwen3 step produces useful but rough output: typos
from FUNASR transcription drift, half-finished punctuation, occasional
mis-spellings of book titles / philosopher names / film titles, etc.
GPT-5.4 with low reasoning is a cheap cleanup pass that:

* Fixes 错别字 (typos) the homophone-prone FUNASR misses
* Normalizes punctuation and quote marks
* Extracts important named entities (people, works, terms)
* Validates the entities against the transcript context — if a name was
  transcribed phonetically and is wrong, it gets corrected here

The polish is *additive*: we never lose the original content. Failure
of the polish step is non-fatal — the unpolished notes are still
useful, so we surface a warning and keep going.

Disabled by default. Set ``POLISH_API_KEY`` (and optionally
``POLISH_BASE_URL`` / ``POLISH_MODEL``) to enable.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx


logger = logging.getLogger(__name__)


_BASE_URL = os.getenv("POLISH_BASE_URL", "https://claude.chivier.site")
_MODEL = os.getenv("POLISH_MODEL", "gpt-5.4")
_REASONING = os.getenv("POLISH_REASONING_EFFORT", "low")
_API_KEY = os.getenv("POLISH_API_KEY", "").strip()
_TIMEOUT = float(os.getenv("POLISH_TIMEOUT_SEC", "120"))


def is_enabled() -> bool:
    return bool(_API_KEY)


_PROMPT = """\
你是一位中文视频笔记的校对编辑。下面是 AI 生成的视频笔记草稿，FUNASR 转写 \
+ 本地 LLM 整理产生，可能含错别字、标点不规范、专有名词识别错误（人名、书名、 \
术语等）。请基于转写稿对 summary / sections / key_topics 做精校：

要求：
- 修正错别字、同音字误识、断句错误
- 中文标点规范（。，、；："" '' ——……）
- 修正/补全人名、作品名、专业术语，必要时根据语境推断（例如 "肉文集" 推断 \
  应为 "刘文集"，"杜恩斯坦" 推断应为 "维特根斯坦"）。如果不确定，用 \
  "[名称?]" 的格式标注一个候选
- 提取重要实体到 entities 字段，分类为 people / works / terms / places \
  / events，每条带一个简短解释
- summary 不要扩写，只精校
- 必须输出严格 JSON，不要 markdown 围栏
- 思维导图由独立的步骤生成，本步骤无需输出 mindmap 字段

视频标题：{title}

转写稿（用于校对参考，可能很长）：
\"\"\"
{transcript}
\"\"\"

笔记草稿（待精校）：
\"\"\"
{notes_json}
\"\"\"

请输出 JSON：
{{
  "summary": "精校后的整体总结",
  "key_topics": ["..."],
  "sections": [
    {{ "title": "...", "timestamp": "...", "summary": "...", "key_points": ["..."], "details": "..." }}
  ],
  "entities": {{
    "people":  [{{"name": "...", "note": "可选简介"}}],
    "works":   [{{"name": "...", "note": "..."}}],
    "terms":   [{{"name": "...", "note": "..."}}],
    "places":  [{{"name": "...", "note": "..."}}],
    "events":  [{{"name": "...", "note": "..."}}]
  }},
  "polish_notes": "可选：你做了哪些显著修正的简短说明"
}}
"""


def _truncate_transcript(transcript: str, max_chars: int = 20000) -> str:
    """Keep prompt size bounded. Mid-large videos still fit; very long
    transcripts get the head + tail (the middle is rarely where named
    entity errors hide; the head sets up topics, the tail summarizes)."""
    if len(transcript) <= max_chars:
        return transcript
    half = max_chars // 2
    return (
        transcript[:half]
        + "\n[…middle truncated for prompt budget…]\n"
        + transcript[-half:]
    )


def _strip_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        if s.endswith("```"):
            s = s[: -3]
        s = s.strip()
    return s


def _coerce_json(raw: str) -> dict[str, Any] | None:
    cleaned = _strip_fence(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(cleaned)):
        ch = cleaned[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(cleaned[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


async def polish(
    *,
    title: str | None,
    transcript: str,
    notes: dict[str, Any],
) -> dict[str, Any]:
    """Polish a notes dict. Returns the polished dict, or the original
    if the API is disabled or fails.

    The polished dict has the same shape as the input plus an
    ``entities`` field; ``polish_notes`` is included if the model
    surfaced one.
    """
    if not is_enabled():
        return notes

    prompt = _PROMPT.format(
        title=title or "(未提供)",
        transcript=_truncate_transcript(transcript or ""),
        notes_json=json.dumps(notes, ensure_ascii=False),
    )
    body = {
        "model": _MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "reasoning_effort": _REASONING,
        "max_completion_tokens": 8192,
    }
    headers = {
        "Authorization": f"Bearer {_API_KEY}",
        "Content-Type": "application/json",
    }
    url = f"{_BASE_URL.rstrip('/')}/v1/chat/completions"

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(url, json=body, headers=headers)
            r.raise_for_status()
            data = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("polish: API call failed (returning unpolished): %s", exc)
        return notes

    raw = ""
    try:
        raw = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        logger.warning("polish: malformed response: %s", str(data)[:200])
        return notes

    parsed = _coerce_json(raw)
    if parsed is None:
        logger.warning(
            "polish: model returned non-JSON, keeping unpolished. raw=%s", raw[:200]
        )
        return notes

    # Merge: keys present in `parsed` win, but anything missing falls
    # back to original notes — defensive in case the model drops a field.
    out = dict(notes)
    for key in ("summary", "key_topics", "sections"):
        if key in parsed:
            out[key] = parsed[key]
    if "entities" in parsed and isinstance(parsed["entities"], dict):
        out["entities"] = parsed["entities"]
    if "polish_notes" in parsed:
        out["polish_notes"] = parsed["polish_notes"]
    out["polished"] = True
    return out
