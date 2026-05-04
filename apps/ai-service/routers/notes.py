"""Notes router — combined FUNASR transcription + structured note generation.

Endpoints
---------
POST /api/notes/generate
    Accept a file path, queue a background job that runs FUNASR then the
    LLM, return the job id immediately.

GET /api/notes/jobs/{job_id}
    Poll status / fetch the final notes payload.

The whole thing is in-memory like the existing subtitle/summarize
routers — fine for a single-instance deployment. If the user later
wants persistence they can swap the dict for a SQLite table without
touching the routes.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import uuid
from dataclasses import asdict, dataclass, field
from typing import Annotated, Any, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Path
from pydantic import BaseModel, Field

from models.schemas import JobStatus, SubtitleSegment
from services.funasr_service import funasr_service
from services.notes_service import generate_notes
from services.polish_service import is_enabled as polish_enabled, polish


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/notes", tags=["notes"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class NotesRequest(BaseModel):
    file_path: str
    title: Optional[str] = None
    language: str = "zh"


class NotesJobQueued(BaseModel):
    job_id: str
    status: JobStatus = JobStatus.queued


class NotesJobResult(BaseModel):
    job_id: str
    status: JobStatus
    file_path: str = ""
    title: Optional[str] = None
    language: str = "zh"
    transcript: str = ""
    summary: str = ""
    key_topics: list[str] = Field(default_factory=list)
    sections: list[dict[str, Any]] = Field(default_factory=list)
    mindmap: str = ""
    entities: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    polished: bool = False
    polish_notes: Optional[str] = None
    error: Optional[str] = None
    created_at: Optional[dt.datetime] = None
    updated_at: Optional[dt.datetime] = None


# ---------------------------------------------------------------------------
# In-memory job store
# ---------------------------------------------------------------------------


@dataclass
class _NotesJob:
    job_id: str
    file_path: str
    title: Optional[str]
    language: str
    status: JobStatus = JobStatus.queued
    transcript: str = ""
    summary: str = ""
    key_topics: list[str] = field(default_factory=list)
    sections: list[dict[str, Any]] = field(default_factory=list)
    mindmap: str = ""
    entities: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    polished: bool = False
    polish_notes: Optional[str] = None
    error: Optional[str] = None
    created_at: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc))
    updated_at: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc))

    def touch(self) -> None:
        self.updated_at = dt.datetime.now(dt.timezone.utc)

    def to_result(self) -> NotesJobResult:
        return NotesJobResult(
            job_id=self.job_id,
            status=self.status,
            file_path=self.file_path,
            title=self.title,
            language=self.language,
            transcript=self.transcript,
            summary=self.summary,
            key_topics=self.key_topics,
            sections=self.sections,
            mindmap=self.mindmap,
            entities=self.entities,
            polished=self.polished,
            polish_notes=self.polish_notes,
            error=self.error,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


_jobs: dict[str, _NotesJob] = {}


# ---------------------------------------------------------------------------
# Background pipeline
# ---------------------------------------------------------------------------


async def _run_notes(job_id: str) -> None:
    job = _jobs.get(job_id)
    if job is None:
        return

    job.status = JobStatus.processing
    job.touch()
    logger.info("notes job %s: starting (file=%s)", job_id, job.file_path)

    # 1. Transcribe
    segments: list[SubtitleSegment] = []
    try:
        segments = await funasr_service.transcribe(
            file_path=job.file_path,
            language="auto",
        )
    except FileNotFoundError as exc:
        job.status = JobStatus.failed
        job.error = str(exc)
        job.touch()
        logger.warning("notes job %s: file not found: %s", job_id, exc)
        return
    except Exception as exc:  # noqa: BLE001
        job.status = JobStatus.failed
        job.error = f"transcription error: {exc}"
        job.touch()
        logger.exception("notes job %s: transcribe failed", job_id)
        return

    if not segments:
        job.status = JobStatus.failed
        job.error = "no speech detected in file"
        job.touch()
        return

    # Persist transcript text upfront so partial failures still leave the
    # user with something useful.
    job.transcript = "\n".join(seg.text for seg in segments)
    job.touch()

    # 2. Summarize / structure
    try:
        notes = await generate_notes(
            segments=segments,
            title=job.title,
            language=job.language,
        )
        job.summary = notes["summary"]
        job.key_topics = notes["key_topics"]
        job.sections = notes["sections"]
        job.mindmap = notes["mindmap"]
        # Stage 3: optional GPT-5.4 polish. Non-fatal — if the upstream
        # endpoint hiccups, we keep the unpolished notes and mark
        # polished=False. The dedicated repolish script can retry later.
        if polish_enabled():
            try:
                polished = await polish(
                    title=job.title,
                    transcript=job.transcript,
                    notes={
                        "summary": job.summary,
                        "key_topics": job.key_topics,
                        "sections": job.sections,
                        "mindmap": job.mindmap,
                    },
                )
                if polished.get("polished"):
                    job.summary = polished.get("summary", job.summary)
                    job.key_topics = polished.get("key_topics", job.key_topics)
                    job.sections = polished.get("sections", job.sections)
                    job.mindmap = polished.get("mindmap", job.mindmap)
                    job.entities = polished.get("entities", {}) or {}
                    job.polish_notes = polished.get("polish_notes")
                    job.polished = True
                    logger.info("notes job %s: polished by %s", job_id, "GPT-5.4")
            except Exception as exc:  # noqa: BLE001
                logger.warning("notes job %s: polish step failed: %s", job_id, exc)
        job.status = JobStatus.done
        logger.info("notes job %s: done", job_id)
    except Exception as exc:  # noqa: BLE001
        # We've already populated transcript above — surface the partial
        # result with a failed status so the UI can still show the
        # transcript even when the summarization step blew up.
        job.status = JobStatus.failed
        job.error = f"notes generation error: {exc}"
        logger.exception("notes job %s: generation failed", job_id)
    finally:
        job.touch()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/generate", response_model=NotesJobQueued, status_code=202)
async def submit(request: NotesRequest, background_tasks: BackgroundTasks) -> NotesJobQueued:
    job_id = str(uuid.uuid4())
    job = _NotesJob(
        job_id=job_id,
        file_path=request.file_path,
        title=request.title,
        language=request.language,
    )
    _jobs[job_id] = job
    background_tasks.add_task(_run_notes, job_id)
    logger.info("notes job %s queued for %s", job_id, request.file_path)
    return NotesJobQueued(job_id=job_id, status=JobStatus.queued)


@router.get("/jobs/{job_id}", response_model=NotesJobResult)
async def get_job(
    job_id: Annotated[str, Path(description="Job ID returned by /generate")],
) -> NotesJobResult:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"job not found: {job_id}")
    return job.to_result()


@router.get("/jobs")
async def list_jobs() -> dict[str, Any]:
    items = sorted(
        (job.to_result().model_dump() for job in _jobs.values()),
        key=lambda j: j.get("created_at") or "",
        reverse=True,
    )
    return {"items": items, "total": len(items)}
