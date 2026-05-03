"""HTTP client for mediago-core's REST API.

Two responsibilities:

* Enqueue a freshly-discovered video for download (POST /api/downloads).
  mediago-core takes a *batch* shape — even for one URL we wrap it in a
  one-element ``tasks`` list because that's the only shape its handler
  accepts.

* Poll the status of an enqueued download. The follow-tracker poller
  loop calls this to notice when a download succeeds and we can fire
  the AI pipeline.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from config import MEDIAGO_BASE_URL


logger = logging.getLogger(__name__)


class MediagoClientError(Exception):
    pass


class MediagoClient:
    def __init__(self, base_url: str = MEDIAGO_BASE_URL) -> None:
        self._client = httpx.Client(base_url=base_url, timeout=30)

    def close(self) -> None:
        self._client.close()

    # ------------------------------------------------------------------
    # Submission
    # ------------------------------------------------------------------

    def enqueue(
        self,
        *,
        url: str,
        download_type: str,
        name: Optional[str] = None,
        folder: Optional[str] = None,
        start: bool = True,
    ) -> int:
        """POST /api/downloads as a one-element batch.

        Returns the new download id (Go core's videos.id).
        """
        task: dict[str, Any] = {"type": download_type, "url": url}
        if name:
            task["name"] = name
        if folder:
            task["folder"] = folder

        body = {"tasks": [task], "startDownload": start}
        try:
            r = self._client.post("/api/downloads", json=body)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise MediagoClientError(f"enqueue failed: {exc}") from exc

        envelope = r.json()
        if not envelope.get("success"):
            raise MediagoClientError(f"enqueue not successful: {envelope.get('message')}")

        data = envelope.get("data") or []
        if isinstance(data, list) and data and isinstance(data[0], dict) and "id" in data[0]:
            return int(data[0]["id"])
        # Some versions returned {ids: [...]}
        if isinstance(data, dict) and "ids" in data and data["ids"]:
            return int(data["ids"][0])
        raise MediagoClientError(f"enqueue: unrecognized response shape: {envelope!r}")

    # ------------------------------------------------------------------
    # Status polling
    # ------------------------------------------------------------------

    def get_download(self, download_id: int) -> Optional[dict[str, Any]]:
        try:
            r = self._client.get(f"/api/downloads/{download_id}")
        except httpx.HTTPError as exc:
            raise MediagoClientError(f"get_download failed: {exc}") from exc
        if r.status_code == 404:
            return None
        try:
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise MediagoClientError(f"get_download {r.status_code}: {exc}") from exc
        envelope = r.json()
        if not envelope.get("success"):
            return None
        return envelope.get("data")

    def list_downloads(self, *, page: int = 1, page_size: int = 100) -> list[dict[str, Any]]:
        try:
            r = self._client.get(
                "/api/downloads",
                params={"current": page, "pageSize": page_size},
            )
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise MediagoClientError(f"list_downloads failed: {exc}") from exc
        envelope = r.json()
        if not envelope.get("success"):
            return []
        data = envelope.get("data") or {}
        return data.get("list") or []
