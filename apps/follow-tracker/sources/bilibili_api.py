"""Bilibili source — direct HTTP with WBI signing.

This is the lighter primary source for Bilibili. It calls
``api.bilibili.com/x/space/wbi/arc/search`` with the WBI ``w_rid`` /
``wts`` signature B站 added in 2023. Everything documented at
https://github.com/SocialSisterYi/bilibili-API-collect is implemented
inline here so we avoid pulling in the full ``bilibili-api-python``
async stack.

Cookies — including ``buvid3``, ``b_nut`` and ``bili_ticket`` — are
fetched on-demand from the public homepage. If the user has supplied a
``BILI_SESSDATA`` for a logged-in session it gets layered in too, which
significantly improves the per-IP rate limit.

Failure modes that should fall back to Selenium:

* HTTP 412 / -799 / -352  → risk-control bounced the request
* HTTP 5xx / network error → upstream blip; selenium retries can paper
  over transient issues
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
import urllib.parse
from typing import Any, Iterator, Optional

import httpx

from .base import DiscoveredVideo, SourceError


logger = logging.getLogger(__name__)


NAV_URL = "https://api.bilibili.com/x/web-interface/nav"
SEARCH_URL = "https://api.bilibili.com/x/space/wbi/arc/search"
USER_INFO_URL = "https://api.bilibili.com/x/space/wbi/acc/info"
HOME_URL = "https://www.bilibili.com"

# WBI mixin permutation — fixed indices the official client uses to
# scramble the (img_key + sub_key) into the 32-char mixin_key. Sourced
# from https://github.com/SocialSisterYi/bilibili-API-collect.
_MIXIN_KEY_ENC_TAB: list[int] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]


def _user_agent() -> str:
    return os.getenv(
        "BILI_USER_AGENT",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    )


def _build_client() -> httpx.Client:
    headers = {
        "User-Agent": _user_agent(),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Origin": "https://space.bilibili.com",
        "Referer": "https://space.bilibili.com/",
    }
    sessdata = os.getenv("BILI_SESSDATA")
    if sessdata:
        headers["Cookie"] = f"SESSDATA={sessdata}"
    return httpx.Client(
        headers=headers,
        timeout=20,
        follow_redirects=True,
        # cookies persist across requests in the same client; we hit the
        # homepage first so b_nut / buvid3 are accepted by subsequent calls.
    )


def _warmup(client: httpx.Client) -> None:
    """Hit the homepage so the server hands us its anti-bot cookies."""
    try:
        client.get(HOME_URL)
    except httpx.HTTPError as exc:
        logger.debug("warmup home fetch failed (non-fatal): %s", exc)


def _get_wbi_keys(client: httpx.Client) -> tuple[str, str]:
    """Fetch and parse the current WBI img_key + sub_key.

    These rotate roughly daily so we re-fetch on every Source instance.
    """
    try:
        r = client.get(NAV_URL)
        r.raise_for_status()
    except httpx.HTTPError as exc:
        raise SourceError(f"WBI nav fetch failed: {exc}") from exc
    payload = r.json()
    wbi = payload.get("data", {}).get("wbi_img") or {}
    img_url = wbi.get("img_url") or ""
    sub_url = wbi.get("sub_url") or ""
    if not img_url or not sub_url:
        raise SourceError(f"WBI nav response missing keys: {payload}")
    img_key = img_url.rsplit("/", 1)[-1].split(".", 1)[0]
    sub_key = sub_url.rsplit("/", 1)[-1].split(".", 1)[0]
    return img_key, sub_key


def _mixin_key(img_key: str, sub_key: str) -> str:
    raw = img_key + sub_key
    permuted = "".join(raw[i] for i in _MIXIN_KEY_ENC_TAB if i < len(raw))
    return permuted[:32]


def _sign(params: dict[str, Any], mixin: str) -> dict[str, Any]:
    params = dict(params)
    params["wts"] = int(time.time())
    # Sort keys, then strip characters B站 disallows in values.
    items = sorted(params.items(), key=lambda kv: kv[0])
    sanitized = []
    for k, v in items:
        s = str(v)
        for bad in "!'()*":
            s = s.replace(bad, "")
        sanitized.append((k, s))
    query = urllib.parse.urlencode(sanitized)
    params["w_rid"] = hashlib.md5((query + mixin).encode("utf-8")).hexdigest()
    return params


def _is_risk_control(payload: dict[str, Any]) -> bool:
    code = payload.get("code")
    return code in {-352, -403, -412, -799, -509}


class BilibiliApiSource:
    """Direct WBI-signed access to ``api.bilibili.com``."""

    def fetch(self, mid: str, *, max_pages: int = 5) -> Iterator[DiscoveredVideo]:
        with _build_client() as client:
            _warmup(client)
            try:
                img_key, sub_key = _get_wbi_keys(client)
            except SourceError:
                raise
            mixin = _mixin_key(img_key, sub_key)

            page = 1
            while page <= max_pages:
                params = {
                    "mid": int(mid),
                    "pn": page,
                    "ps": 30,
                    "order": "pubdate",
                    "platform": "web",
                    "web_location": "1550101",
                }
                signed = _sign(params, mixin)
                try:
                    r = client.get(SEARCH_URL, params=signed)
                    r.raise_for_status()
                    data = r.json()
                except (httpx.HTTPError, ValueError) as exc:
                    raise SourceError(f"space {mid} page {page}: {exc}") from exc

                if _is_risk_control(data):
                    raise SourceError(
                        f"space {mid}: risk-control rejected (code {data.get('code')}: {data.get('message')})"
                    )
                if data.get("code") != 0:
                    raise SourceError(
                        f"space {mid}: code={data.get('code')} msg={data.get('message')}"
                    )

                vlist = (data.get("data") or {}).get("list", {}).get("vlist") or []
                if not vlist:
                    return

                for v in vlist:
                    bvid = v.get("bvid") or ""
                    if not bvid:
                        continue
                    yield DiscoveredVideo(
                        external_id=bvid,
                        title=v.get("title") or "",
                        url=f"https://www.bilibili.com/video/{bvid}/",
                        pub_date=str(v.get("created") or "") or None,
                        duration=v.get("length") or None,
                        cover_url=_https(v.get("pic")) or None,
                    )

                count = (data.get("data") or {}).get("page", {}).get("count", 0)
                if page * 30 >= count:
                    return
                page += 1
                # Polite pacing — anonymous calls get throttled fast at >2 req/s.
                time.sleep(0.7)

    def resolve(self, mid_or_name: str) -> tuple[str, str]:
        """Look up a creator's display name from a numeric mid.

        Pure-API resolver only handles mids — name search needs the
        ``/x/web-interface/wbi/search/type`` endpoint which lives behind
        the same risk-control gate, so we punt that to the Selenium
        source.
        """
        if not mid_or_name.isdigit():
            raise SourceError("API source can only resolve numeric mids")

        with _build_client() as client:
            _warmup(client)
            img_key, sub_key = _get_wbi_keys(client)
            mixin = _mixin_key(img_key, sub_key)
            signed = _sign({"mid": int(mid_or_name), "platform": "web", "web_location": "333.999"}, mixin)
            try:
                r = client.get(USER_INFO_URL, params=signed)
                r.raise_for_status()
                data = r.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise SourceError(str(exc)) from exc

        if _is_risk_control(data) or data.get("code") != 0:
            raise SourceError(
                f"resolve {mid_or_name}: code={data.get('code')} msg={data.get('message')}"
            )
        name = (data.get("data") or {}).get("name") or f"User_{mid_or_name}"
        return mid_or_name, name


def _https(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    if url.startswith("//"):
        return "https:" + url
    return url
