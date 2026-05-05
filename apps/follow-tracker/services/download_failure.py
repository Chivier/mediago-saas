from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class FailureAnalysis:
    category: str
    reason: str
    excerpt: str
    should_retry: bool
    retry_delay_seconds: int
    max_retries: int


def analyze_failure(log_text: str | None) -> FailureAnalysis:
    excerpt = _excerpt(log_text)
    haystack = (log_text or "").lower()

    for category, reason, should_retry, delay, max_retries, patterns in _RULES:
        if any(re.search(pattern, haystack, re.IGNORECASE) for pattern in patterns):
            return FailureAnalysis(
                category=category,
                reason=reason,
                excerpt=excerpt,
                should_retry=should_retry,
                retry_delay_seconds=delay,
                max_retries=max_retries,
            )

    if not excerpt:
        excerpt = "No failure log available from mediago-core."

    return FailureAnalysis(
        category="unknown",
        reason="Unclassified failure from mediago-core logs",
        excerpt=excerpt,
        should_retry=True,
        retry_delay_seconds=180,
        max_retries=1,
    )


def _excerpt(log_text: str | None, *, max_chars: int = 1600, max_lines: int = 12) -> str:
    if not log_text:
        return ""
    lines = [line.strip() for line in log_text.splitlines() if line.strip()]
    if not lines:
        return ""
    excerpt = "\n".join(lines[-max_lines:])
    return excerpt[-max_chars:]


_RULES: list[tuple[str, str, bool, int, int, tuple[str, ...]]] = [
    (
        "paid_preview_or_member_only",
        "Likely paid or member-only content",
        False,
        0,
        0,
        (
            r"member[- ]only",
            r"members only",
            r"付费",
            r"试看",
            r"大会员",
            r"会员",
            r"购买后",
            r"仅限.*会员",
        ),
    ),
    (
        "source_removed_or_private",
        "Source video looks deleted, private, or unavailable",
        False,
        0,
        0,
        (
            r"video unavailable",
            r"private video",
            r"this video is private",
            r"not found",
            r"404",
            r"稿件不存在",
            r"视频不存在",
            r"已失效",
            r"已删除",
            r"已下架",
            r"私密",
        ),
    ),
    (
        "filesystem_or_permissions",
        "Filesystem or permission problem on the server",
        False,
        0,
        0,
        (
            r"permission denied",
            r"read-only file system",
            r"no space left on device",
            r"disk quota exceeded",
            r"file name too long",
            r"cannot create",
            r"mkdir",
        ),
    ),
    (
        "bbdown_null_reference",
        "BBDown hit Arg_NullReferenceException during Bilibili parsing",
        True,
        300,
        1,
        (
            r"arg_nullreferenceexception",
            r"nullreferenceexception",
        ),
    ),
    (
        "bbdown_key_not_found",
        "BBDown hit Arg_KeyNotFound during Bilibili parsing",
        True,
        300,
        1,
        (
            r"arg_keynotfound",
            r"keynotfound",
        ),
    ),
    (
        "rate_limited_or_transient_network",
        "Likely transient rate limit or network issue",
        True,
        300,
        3,
        (
            r"429",
            r"too many requests",
            r"timeout",
            r"timed out",
            r"connection reset",
            r"connection refused",
            r"temporarily unavailable",
            r"try again later",
            r"i/o timeout",
            r"context deadline exceeded",
            r"502",
            r"503",
            r"504",
        ),
    ),
    (
        "auth_cookie_invalid_or_missing",
        "Likely missing, expired, or insufficient login cookies",
        True,
        120,
        1,
        (
            r"sessdata",
            r"cookie",
            r"login required",
            r"please log in",
            r"未登录",
            r"需要登录",
            r"risk control",
            r"风控",
            r"-352",
            r"access denied",
            r"forbidden",
        ),
    ),
    (
        "unsupported_extractor_or_parse",
        "Downloader could not parse or extract this source",
        True,
        180,
        1,
        (
            r"unsupported",
            r"extractor",
            r"parse",
            r"解析",
            r"no video formats found",
            r"unable to extract",
            r"unrecognized",
        ),
    ),
]
