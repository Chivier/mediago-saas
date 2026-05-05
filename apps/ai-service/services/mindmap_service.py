"""Markmap mindmap generation — separate from the main notes pass.

The original pipeline generated the mindmap alongside summary/sections in
one big LLM call as Mermaid ``mindmap`` syntax. That coupling had two
problems:

1. The mindmap was constrained by whatever JSON the rest of the prompt
   produced — it tended to be shallow, just restating section titles.
2. For long videos (>30 min) the single-pass model would lose detail in
   the middle: with a 30K-char prompt budget, the LLM has to compress
   the whole transcript into ~50 mindmap nodes total.

This module fixes both. The mindmap is now generated AFTER the structured
notes (and after polish), with the transcript + summary + sections as
explicit context. For long videos, the transcript is split into 10-min
windows; each window gets its own per-chunk mindmap from the local LLM,
and a final GPT-5.4 call merges them into one consolidated tree.

Output is markmap-flavored markdown — nested ``#``/``##``/``-`` lists.
That's what https://markmap.js.org consumes natively, and it doubles as
a perfectly readable plain-text outline that we can save to disk as
``mindmap.md``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any

import httpx

from models.schemas import SubtitleSegment
from services.lmstudio_service import lmstudio_service


logger = logging.getLogger(__name__)


# Videos longer than this get split into chunks before mindmap generation.
# 30 min keeps single-call quality high for typical talks/episodes; longer
# lectures/podcasts/movie commentaries trip the chunked path.
LONG_VIDEO_THRESHOLD_SECONDS = int(os.getenv("MINDMAP_LONG_THRESHOLD_SECONDS", "1800"))
# Window size when splitting. 10 min is small enough that one local LLM
# call captures the chunk faithfully and large enough that a 60-min video
# only needs 6 calls.
CHUNK_WINDOW_SECONDS = int(os.getenv("MINDMAP_CHUNK_WINDOW_SECONDS", "600"))

# Per-chunk LLM call concurrency cap. Ollama serializes anyway; the cap
# keeps us from queueing dozens of HTTP requests at once.
_CHUNK_SEMAPHORE: asyncio.Semaphore = asyncio.Semaphore(
    int(os.getenv("MINDMAP_CHUNK_CONCURRENCY", "1"))
)

# GPT merge endpoint reuses the polish credentials (same upstream).
_MERGE_BASE_URL = os.getenv("POLISH_BASE_URL", "https://claude.chivier.site")
_MERGE_MODEL = os.getenv("MINDMAP_MERGE_MODEL", os.getenv("POLISH_MODEL", "gpt-5.4"))
_MERGE_REASONING = os.getenv(
    "MINDMAP_MERGE_REASONING_EFFORT", os.getenv("POLISH_REASONING_EFFORT", "medium")
)
_MERGE_API_KEY = os.getenv("POLISH_API_KEY", "").strip()
_MERGE_TIMEOUT = float(os.getenv("MINDMAP_MERGE_TIMEOUT_SEC", "180"))


def _format_timestamp(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _segments_duration(segments: list[SubtitleSegment]) -> float:
    if not segments:
        return 0.0
    return float(segments[-1].end)


def _segments_to_timed_text(
    segments: list[SubtitleSegment], max_chars: int = 24000
) -> str:
    """Render segments as ``[hh:mm:ss] text`` lines. Drops the head if needed
    to keep the prompt under budget — a video's setup matters less than its
    payoff for a hierarchical mindmap."""
    lines = [f"[{_format_timestamp(seg.start)}] {seg.text}" for seg in segments]
    full = "\n".join(lines)
    if len(full) <= max_chars:
        return full
    out: list[str] = []
    total = 0
    for line in reversed(lines):
        if total + len(line) + 1 > max_chars:
            break
        out.append(line)
        total += len(line) + 1
    out.reverse()
    return "[…earlier transcript truncated…]\n" + "\n".join(out)


def _split_segments_by_window(
    segments: list[SubtitleSegment], window_seconds: int
) -> list[list[SubtitleSegment]]:
    """Group segments into time windows. A segment goes into the window
    that contains its start time; segments straddling a boundary stay
    intact on the side they started."""
    if not segments:
        return []
    chunks: list[list[SubtitleSegment]] = []
    current: list[SubtitleSegment] = []
    boundary = window_seconds
    for seg in segments:
        if seg.start >= boundary and current:
            chunks.append(current)
            current = []
            # Skip empty intermediate windows in case of a long silence.
            while seg.start >= boundary:
                boundary += window_seconds
        current.append(seg)
    if current:
        chunks.append(current)
    return chunks


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


_SINGLE_PROMPT_ZH = """\
你是一个视频内容分析助手。下面是视频的转写稿、整体总结和章节列表。请基于这些 \
信息生成一份**层级清晰**的思维导图，使用 markmap.js 兼容的 markdown 格式：

- 用 `#` / `##` / `###` / `####` 表示层级
- 用 `-` 列表项表示叶节点
- 不要使用 mermaid 语法
- 第一行必须是 `# 视频标题`（一级标题作为根节点）
- 二级标题 `##` 表示视频主要分支（4-8 个）
- 三级标题或列表项展开细节
- 必要时用 `**关键词**` 加粗重要概念

要求：
- 所有信息必须出自转写稿，不要编造
- 优先抓主线、不要陷入细节
- 节点文字简洁（一般不超过 25 字）
- 完整覆盖视频内容（不要只覆盖前 1/3）

视频标题：{title}

整体总结：
{summary}

核心主题：
{key_topics}

章节列表（用作分支参考）：
{sections}

字幕（[hh:mm:ss] 文本）：
{transcript}

只输出 markdown，不要包裹在代码块里。
"""

_SINGLE_PROMPT_EN = """\
You are a video content analyst. Below is a video's transcript, summary, \
and section breakdown. Generate a **clearly hierarchical** mindmap in \
markmap.js-compatible markdown:

- Use `#` / `##` / `###` / `####` for hierarchy
- Use `-` bullets for leaves
- Do NOT use mermaid syntax
- First line must be `# Video Title` (level-1 heading is the root)
- `##` is for main branches (4-8 of them)
- `###` or bullet items expand details
- Use `**bold**` to highlight key concepts when useful

Requirements:
- All content must come from the transcript — no fabrication
- Prioritize the main thread; don't drown in detail
- Node text concise (usually < 25 chars)
- Cover the entire video, not just the opening third

Title: {title}

Summary:
{summary}

Key topics:
{key_topics}

Sections (reference branches):
{sections}

Transcript ([hh:mm:ss] text):
{transcript}

Output markdown only, no fences.
"""


_CHUNK_PROMPT_ZH = """\
这是一个长视频的第 {chunk_index}/{total_chunks} 个 10 分钟片段（{time_range}）。\
请用 markmap.js 兼容的 markdown 格式生成**这一片段**的思维导图：

- 用 `## {chunk_title}` 作为顶层（注意是 `##` 不是 `#`，因为后面会合并到完整 \
  导图里作为一个分支）
- 三级标题或列表项展开细节
- 不要重复视频整体总结，只关注本段内容
- 节点文字简洁

视频标题：{title}

本段字幕：
{transcript}

只输出 markdown，从 `## {chunk_title}` 开始。
"""

_CHUNK_PROMPT_EN = """\
This is the {chunk_index}/{total_chunks} 10-minute chunk ({time_range}) of \
a long video. Generate a markmap.js-compatible markdown mindmap **for this \
chunk only**:

- Start with `## {chunk_title}` as the top heading (use `##` not `#`; this \
  will be merged into the complete tree as one branch later)
- `###` or bullets expand details
- Don't repeat the overall video summary; just this chunk's content
- Keep node text concise

Title: {title}

Chunk transcript:
{transcript}

Output markdown only, starting with `## {chunk_title}`.
"""


_MERGE_PROMPT_ZH = """\
你是思维导图编辑。下面是一个长视频被切成 {n_chunks} 段后，每段 LLM 单独生成的 \
markmap markdown。请把它们合并成**一份连贯的整体思维导图**：

- 第一行必须是 `# {title}`（用整个视频的标题作为根）
- 二级标题 `##` 表示主要分支：可以保留每段的二级标题作为分支，也可以重组（合并 \
  内容相近的、拆分过大的、按主题而非时间重组）
- 删除重复内容、合并相似要点
- 整体节点数控制在 30-80 个左右，不要太密
- 保留每段中真正有信息量的细节，不要简化到只有标题
- 输出有效的 markdown，不要 mermaid

视频标题：{title}

整体总结（参考）：
{summary}

各段思维导图：
{partials}

只输出合并后的 markdown，不要解释。
"""


_MERGE_PROMPT_EN = """\
You are a mindmap editor. Below are {n_chunks} per-chunk mindmaps from a \
long video, each generated independently in markmap markdown. Merge them \
into **one coherent consolidated mindmap**:

- First line must be `# {title}` (use the full video title as root)
- `##` for main branches: you may keep each chunk's `##` heading as a \
  branch, or restructure (merge similar chunks, split oversized ones, \
  reorganize by topic instead of time)
- Remove duplicates, consolidate similar points
- Total node count around 30-80 — don't over-densify
- Preserve genuinely informative detail; don't collapse to just titles
- Output valid markdown, NO mermaid

Title: {title}

Overall summary (reference):
{summary}

Per-chunk mindmaps:
{partials}

Output the consolidated markdown only, no explanation.
"""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _strip_fence(s: str) -> str:
    """LLMs sometimes still wrap their output in ```markdown fences despite
    being told not to. Peel them off."""
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        if s.endswith("```"):
            s = s[: -3]
    return s.strip()


def _format_sections_for_prompt(sections: list[dict[str, Any]]) -> str:
    if not sections:
        return "(no section breakdown)"
    out = []
    for i, sec in enumerate(sections, 1):
        title = sec.get("title") or f"Section {i}"
        ts = sec.get("timestamp")
        summary = sec.get("summary") or ""
        line = f"{i}. {title}"
        if ts:
            line += f" [{ts}]"
        if summary:
            line += f" — {summary}"
        out.append(line)
    return "\n".join(out)


async def _call_local_llm(prompt: str, *, max_tokens: int = 3000) -> str:
    """Call the local Ollama-backed LLM through lmstudio_service's pool.

    Uses the same pattern as notes_service to reuse the dedicated Ollama
    semaphore and the model-load guard.
    """
    async with _CHUNK_SEMAPHORE:
        await lmstudio_service._ensure_loaded()  # noqa: SLF001 — intentional reuse
        try:
            response = await lmstudio_service._client.chat.completions.create(  # noqa: SLF001
                model=lmstudio_service._model,  # noqa: SLF001
                messages=[{"role": "user", "content": prompt}],
                temperature=float(os.getenv("MINDMAP_TEMPERATURE", "0.3")),
                max_tokens=max_tokens,
            )
        except Exception as exc:
            logger.exception("mindmap: local LLM call failed: %s", exc)
            raise RuntimeError(f"mindmap LLM error: {exc}") from exc

    import time as _time

    lmstudio_service._last_request = _time.monotonic()  # noqa: SLF001
    return response.choices[0].message.content or ""


async def _call_merge_gpt(prompt: str) -> str:
    """Send the merge prompt to the GPT-5.4 endpoint that polish_service
    uses. Reuses POLISH_API_KEY / POLISH_BASE_URL so deployments don't
    need a second credential."""
    if not _MERGE_API_KEY:
        raise RuntimeError(
            "mindmap merge requires POLISH_API_KEY (reused for the GPT merge call)"
        )
    body = {
        "model": _MERGE_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "reasoning_effort": _MERGE_REASONING,
        "max_completion_tokens": 6000,
    }
    headers = {
        "Authorization": f"Bearer {_MERGE_API_KEY}",
        "Content-Type": "application/json",
    }
    url = f"{_MERGE_BASE_URL.rstrip('/')}/v1/chat/completions"
    async with httpx.AsyncClient(timeout=_MERGE_TIMEOUT) as client:
        r = await client.post(url, json=body, headers=headers)
        r.raise_for_status()
        data = r.json()
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"merge response malformed: {exc}; raw={str(data)[:200]}") from exc


def _ensure_root_heading(markdown: str, title: str) -> str:
    """Make sure the markdown starts with a single ``# title`` line.

    markmap requires exactly one h1 at the top to act as the root. If the
    LLM forgot or used a different title, fix it up so rendering doesn't
    silently break.
    """
    lines = markdown.splitlines()
    if not lines or not lines[0].lstrip().startswith("# "):
        return f"# {title}\n\n{markdown}"
    # Replace whatever h1 is there with the canonical title
    lines[0] = f"# {title}"
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def generate_mindmap(
    *,
    segments: list[SubtitleSegment],
    title: str | None,
    summary: str,
    key_topics: list[str],
    sections: list[dict[str, Any]],
    language: str = "zh",
) -> str:
    """Build a markmap markdown mindmap from transcript + structured notes.

    Long videos (> ``LONG_VIDEO_THRESHOLD_SECONDS``) get split into
    ``CHUNK_WINDOW_SECONDS`` windows; each chunk yields a partial mindmap
    via the local LLM, and a final GPT-5.4 call merges them. Short videos
    use a single local-LLM call with the full transcript + structured
    context. Returns the consolidated markmap markdown — empty string on
    hard failure (caller stays graceful)."""
    if not segments:
        logger.warning("mindmap: no segments provided, returning empty")
        return ""

    safe_title = (title or "未命名视频").strip()
    duration = _segments_duration(segments)
    use_chunking = duration > LONG_VIDEO_THRESHOLD_SECONDS

    if not use_chunking:
        return await _generate_single(
            segments=segments,
            title=safe_title,
            summary=summary,
            key_topics=key_topics,
            sections=sections,
            language=language,
        )

    return await _generate_chunked(
        segments=segments,
        title=safe_title,
        summary=summary,
        key_topics=key_topics,
        sections=sections,
        language=language,
    )


async def _generate_single(
    *,
    segments: list[SubtitleSegment],
    title: str,
    summary: str,
    key_topics: list[str],
    sections: list[dict[str, Any]],
    language: str,
) -> str:
    template = _SINGLE_PROMPT_ZH if language != "en" else _SINGLE_PROMPT_EN
    prompt = template.format(
        title=title,
        summary=summary or "(无)",
        key_topics="\n".join(f"- {t}" for t in (key_topics or [])) or "(无)",
        sections=_format_sections_for_prompt(sections or []),
        transcript=_segments_to_timed_text(segments),
    )
    raw = await _call_local_llm(prompt, max_tokens=3500)
    return _ensure_root_heading(_strip_fence(raw), title)


async def _generate_chunked(
    *,
    segments: list[SubtitleSegment],
    title: str,
    summary: str,
    key_topics: list[str],
    sections: list[dict[str, Any]],
    language: str,
) -> str:
    chunks = _split_segments_by_window(segments, CHUNK_WINDOW_SECONDS)
    if not chunks:
        return ""
    logger.info(
        "mindmap: long video (%.0fs) split into %d chunks of ~%ds",
        _segments_duration(segments),
        len(chunks),
        CHUNK_WINDOW_SECONDS,
    )

    chunk_template = _CHUNK_PROMPT_ZH if language != "en" else _CHUNK_PROMPT_EN

    async def _one_chunk(idx: int, chunk: list[SubtitleSegment]) -> str:
        start_ts = _format_timestamp(chunk[0].start)
        end_ts = _format_timestamp(chunk[-1].end)
        chunk_title = f"{start_ts}-{end_ts}"
        prompt = chunk_template.format(
            title=title,
            chunk_index=idx + 1,
            total_chunks=len(chunks),
            time_range=chunk_title,
            chunk_title=chunk_title,
            transcript=_segments_to_timed_text(chunk, max_chars=12000),
        )
        try:
            raw = await _call_local_llm(prompt, max_tokens=1500)
        except Exception as exc:  # noqa: BLE001
            logger.warning("mindmap chunk %d/%d failed: %s", idx + 1, len(chunks), exc)
            return f"## {chunk_title}\n\n- (chunk generation failed: {exc})"
        body = _strip_fence(raw)
        # If the model forgot the ## prefix, prepend it.
        if not body.lstrip().startswith("## "):
            body = f"## {chunk_title}\n\n{body}"
        return body

    partials = await asyncio.gather(
        *(_one_chunk(i, chunk) for i, chunk in enumerate(chunks))
    )

    # If the GPT merge endpoint isn't configured, concatenate the partials
    # under a root heading. Less polished but still valid markmap.
    if not _MERGE_API_KEY:
        logger.info("mindmap: no POLISH_API_KEY, falling back to naive partial concat")
        body = "\n\n".join(partials)
        return _ensure_root_heading(body, title)

    merge_template = _MERGE_PROMPT_ZH if language != "en" else _MERGE_PROMPT_EN
    merge_prompt = merge_template.format(
        title=title,
        n_chunks=len(chunks),
        summary=summary or "(无)",
        partials="\n\n---\n\n".join(partials),
    )
    try:
        merged = await _call_merge_gpt(merge_prompt)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "mindmap: GPT merge failed (returning concat fallback): %s", exc
        )
        body = "\n\n".join(partials)
        return _ensure_root_heading(body, title)

    return _ensure_root_heading(_strip_fence(merged), title)
