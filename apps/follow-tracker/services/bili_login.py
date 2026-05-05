"""Bilibili QR login — wraps passport.bilibili.com so the admin UI can
issue a one-shot QR code instead of asking users to copy cookies out of
DevTools.

Two endpoints are wrapped:

* ``GET /x/passport-login/web/qrcode/generate``
    Returns ``{url, qrcode_key}``. ``url`` is the deep-link a phone scans
    (``https://passport.bilibili.com/h5-app/passport/login/scan?...``);
    we render it as a PNG on the server so the frontend doesn't need a
    QR library.

* ``GET /x/passport-login/web/qrcode/poll?qrcode_key=...``
    The response's ``data.code`` is the scan state — values from
    https://github.com/SocialSisterYi/bilibili-API-collect:

    * ``0``     → confirmed; cookies are now on the response
    * ``86038`` → qrcode expired (re-generate)
    * ``86090`` → scanned, awaiting phone tap-to-confirm
    * ``86101`` → not scanned yet

    On confirm, B站 sets ``SESSDATA``, ``bili_jct``, ``DedeUserID`` and
    ``DedeUserID__ckMd5`` via Set-Cookie. ``bili_ticket`` is *not* part
    of the QR-flow response; we leave it for the WBI client to mint
    on first request.
"""

from __future__ import annotations

import base64
import io
import logging
import os
from dataclasses import dataclass
from typing import Optional

import httpx


logger = logging.getLogger(__name__)


GENERATE_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate"
POLL_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll"


def _user_agent() -> str:
    return os.getenv(
        "BILI_USER_AGENT",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    )


def _client() -> httpx.Client:
    return httpx.Client(
        headers={
            "User-Agent": _user_agent(),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Origin": "https://www.bilibili.com",
            "Referer": "https://www.bilibili.com/",
        },
        timeout=15,
        follow_redirects=True,
    )


@dataclass
class QrStart:
    qrcode_key: str
    url: str
    qr_png_b64: str  # raw base64, no data: prefix


def start_qr_login() -> QrStart:
    """Hit the generate endpoint and render the URL as a base64 PNG."""
    with _client() as client:
        r = client.get(GENERATE_URL)
        r.raise_for_status()
        payload = r.json()

    if payload.get("code") != 0:
        raise RuntimeError(
            f"qrcode/generate failed: code={payload.get('code')} msg={payload.get('message')}"
        )
    data = payload.get("data") or {}
    url = data.get("url") or ""
    key = data.get("qrcode_key") or ""
    if not url or not key:
        raise RuntimeError(f"qrcode/generate returned empty payload: {payload}")

    return QrStart(qrcode_key=key, url=url, qr_png_b64=_render_qr_png(url))


@dataclass
class QrStatus:
    # pending | scanned | confirmed | expired | error
    status: str
    message: Optional[str] = None
    # Raw cookie blob ready to drop into Creator.cookies. Only populated
    # when status == "confirmed".
    cookies: Optional[str] = None


# B站 status codes from the QR poll endpoint.
_CODE_OK = 0
_CODE_EXPIRED = 86038
_CODE_AWAIT_CONFIRM = 86090
_CODE_NOT_SCANNED = 86101


def poll_qr_login(qrcode_key: str) -> QrStatus:
    """Poll once. Caller is expected to retry every 2-3s until terminal."""
    with _client() as client:
        try:
            r = client.get(POLL_URL, params={"qrcode_key": qrcode_key})
            r.raise_for_status()
            payload = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            return QrStatus(status="error", message=str(exc))

        # The outer envelope can also carry the error (e.g. 412 risk-control).
        if payload.get("code") != 0:
            return QrStatus(
                status="error",
                message=f"poll envelope: code={payload.get('code')} msg={payload.get('message')}",
            )

        data = payload.get("data") or {}
        inner = data.get("code")
        message = data.get("message") or ""

        if inner == _CODE_NOT_SCANNED:
            return QrStatus(status="pending", message=message or "waiting for scan")
        if inner == _CODE_AWAIT_CONFIRM:
            return QrStatus(status="scanned", message=message or "scanned, confirm on phone")
        if inner == _CODE_EXPIRED:
            return QrStatus(status="expired", message=message or "qrcode expired")
        if inner == _CODE_OK:
            cookie_str = _extract_cookie_blob(client.cookies, data.get("url") or "")
            if not cookie_str:
                return QrStatus(
                    status="error",
                    message="confirmed but no cookies were returned",
                )
            return QrStatus(status="confirmed", message="ok", cookies=cookie_str)

        return QrStatus(status="error", message=f"unknown poll code {inner}: {message}")


def _extract_cookie_blob(jar: httpx.Cookies, url: str) -> str:
    """Build the ``k=v; k=v`` blob the rest of follow-tracker expects.

    B站 returns the auth cookies in two places: Set-Cookie headers (already
    captured into ``jar``) and the redirect ``data.url`` query string. We
    prefer the jar — it's authoritative — but fall back to the URL query
    if the jar somehow ended up empty (proxy stripping, etc.).
    """
    wanted = ("SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5", "sid")
    out: list[tuple[str, str]] = []
    for name in wanted:
        # httpx.Cookies.get returns None when missing; iterate in our
        # preferred order so the cookie string is stable.
        v = jar.get(name)
        if v:
            out.append((name, v))

    if not out and url:
        from urllib.parse import urlparse, parse_qs

        qs = parse_qs(urlparse(url).query)
        for name in wanted:
            vals = qs.get(name) or []
            if vals:
                out.append((name, vals[0]))

    if not out:
        return ""
    return "; ".join(f"{k}={v}" for k, v in out)


def _render_qr_png(payload: str) -> str:
    """Encode ``payload`` into a small PNG and return as base64."""
    # Imported lazily so a missing optional dep doesn't kill app startup —
    # only the QR endpoints need it.
    import qrcode

    img = qrcode.make(payload, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")
