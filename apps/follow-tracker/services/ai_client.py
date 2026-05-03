"""HTTP client for the AI service (FastAPI on mediago-ai:8899).

We call the new ``POST /api/notes/generate`` endpoint to request a
transcript + structured summary + mindmap, then poll
``GET /api/notes/jobs/{id}`` until it reaches a terminal state.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from config import AI_BASE_URL


logger = logging.getLogger(__name__)


class AIClientError(Exception):
    pass


class AIClient:
    def __init__(self, base_url: str = AI_BASE_URL) -> None:
        self._client = httpx.Client(base_url=base_url, timeout=60)

    def close(self) -> None:
        self._client.close()

    def submit_notes(self, *, file_path: str, title: Optional[str] = None, language: str = "auto") -> str:
        body: dict[str, Any] = {"file_path": file_path, "language": language}
        if title:
            body["title"] = title
        try:
            r = self._client.post("/api/notes/generate", json=body)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise AIClientError(f"notes submit failed: {exc}") from exc
        data = r.json()
        job_id = data.get("job_id")
        if not job_id:
            raise AIClientError(f"notes submit: missing job_id in {data!r}")
        return job_id

    def get_notes_job(self, job_id: str) -> Optional[dict[str, Any]]:
        try:
            r = self._client.get(f"/api/notes/jobs/{job_id}")
        except httpx.HTTPError as exc:
            raise AIClientError(f"notes poll failed: {exc}") from exc
        if r.status_code == 404:
            return None
        try:
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise AIClientError(f"notes poll {r.status_code}: {exc}") from exc
        return r.json()
