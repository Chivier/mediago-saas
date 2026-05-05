"""Bilibili QR login endpoints.

Two-step flow: ``POST /qr/start`` returns a fresh ``qrcodeKey`` plus the
PNG to render in the UI; ``GET /qr/poll?key=...`` is polled by the UI
every couple of seconds until it returns ``confirmed`` (with the cookie
blob) or ``expired`` (UI offers to regenerate).

Polling stays unauthenticated because nothing identity-bound happens
server-side until the user pastes the returned blob into a creator's
Cookies field — by which point they've already proven they own the
phone that scanned the QR.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from services.bili_login import poll_qr_login, start_qr_login


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/bili-login")


class QrStartOut(BaseModel):
    qrcode_key: str = Field(serialization_alias="qrcodeKey")
    qr_png_b64: str = Field(serialization_alias="qrPngB64")
    # The original deep-link URL — exposed so a power user can copy/paste
    # into a different QR app if the rendered PNG isn't crisp enough.
    url: str

    model_config = ConfigDict(populate_by_name=True)


class QrPollOut(BaseModel):
    status: str  # pending | scanned | confirmed | expired | error
    message: str | None = None
    cookies: str | None = None


@router.post("/qr/start", response_model=QrStartOut)
async def qr_start() -> QrStartOut:
    try:
        result = await asyncio.to_thread(start_qr_login)
    except Exception as exc:  # noqa: BLE001
        logger.exception("qr/start failed")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return QrStartOut(
        qrcode_key=result.qrcode_key,
        qr_png_b64=result.qr_png_b64,
        url=result.url,
    )


@router.get("/qr/poll", response_model=QrPollOut)
async def qr_poll(key: str = Query(..., min_length=8)) -> QrPollOut:
    try:
        result = await asyncio.to_thread(poll_qr_login, key)
    except Exception as exc:  # noqa: BLE001
        logger.exception("qr/poll failed")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return QrPollOut(status=result.status, message=result.message, cookies=result.cookies)
