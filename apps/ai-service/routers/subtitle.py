"""Subtitle / transcription router.

Endpoints
---------
POST /api/subtitle/transcribe
    Accept a file path, enqueue a background transcription job, return job id.

GET /api/subtitle/jobs/{job_id}
    Poll job status and retrieve results.

GET /api/subtitle/jobs/{job_id}/srt
    Download the SRT file as ``text/plain``.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Path
from fastapi.responses import PlainTextResponse

from datetime import datetime, timezone

from models.schemas import (
    JobStatus,
    SubtitleJob,
    SubtitleJobResult,
    SubtitleJobsListResponse,
    TranscribeJobQueued,
    TranscribeRequest,
)
from services.funasr_service import build_srt, funasr_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/subtitle", tags=["subtitle"])

# In-memory job store: job_id -> SubtitleJob
_jobs: dict[str, SubtitleJob] = {}


# ---------------------------------------------------------------------------
# Background task
# ---------------------------------------------------------------------------


async def _run_transcription(job_id: str) -> None:
    """Execute FUNASR transcription for *job_id* and update the job record."""
    job = _jobs.get(job_id)
    if job is None:
        logger.error("Transcription task started for unknown job_id: %s", job_id)
        return

    job.status = JobStatus.processing
    job.updated_at = datetime.now(timezone.utc)
    logger.info("Transcription job %s started for: %s", job_id, job.file_path)

    try:
        segments = await funasr_service.transcribe(
            file_path=job.file_path,
            language=job.language,
        )
        job.subtitles = segments
        job.srt_content = build_srt(segments)
        job.status = JobStatus.done
        logger.info(
            "Transcription job %s done — %d segments", job_id, len(segments)
        )
    except FileNotFoundError as exc:
        job.status = JobStatus.failed
        job.error = str(exc)
        logger.warning("Transcription job %s failed (file not found): %s", job_id, exc)
    except Exception as exc:
        job.status = JobStatus.failed
        job.error = f"Transcription error: {exc}"
        logger.exception("Transcription job %s failed: %s", job_id, exc)
    finally:
        job.updated_at = datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/transcribe", response_model=TranscribeJobQueued, status_code=202)
async def transcribe(
    request: TranscribeRequest,
    background_tasks: BackgroundTasks,
) -> TranscribeJobQueued:
    """Accept a video/audio file path and start an async transcription job.

    Returns immediately with a ``job_id`` that can be polled via
    ``GET /api/subtitle/jobs/{job_id}``.
    """
    job_id = str(uuid.uuid4())
    job = SubtitleJob(
        job_id=job_id,
        file_path=request.file_path,
        language=request.language,
    )
    _jobs[job_id] = job

    # Schedule the transcription to run in the background.
    background_tasks.add_task(_run_transcription, job_id)

    logger.info(
        "Transcription job %s queued for: %s (lang=%s)",
        job_id,
        request.file_path,
        request.language,
    )
    return TranscribeJobQueued(job_id=job_id, status=JobStatus.queued)


@router.get("/jobs", response_model=SubtitleJobsListResponse)
async def list_jobs() -> SubtitleJobsListResponse:
    """Return every subtitle job, newest first."""
    items = sorted(
        (job.to_result() for job in _jobs.values()),
        key=lambda j: j.created_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return SubtitleJobsListResponse(items=items, total=len(items))


@router.get("/jobs/{job_id}", response_model=SubtitleJobResult)
async def get_job(
    job_id: Annotated[str, Path(description="Job ID returned by /transcribe")],
) -> SubtitleJobResult:
    """Poll the status and results of a transcription job."""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return job.to_result()


@router.get("/jobs/{job_id}/srt", response_class=PlainTextResponse)
async def get_srt(
    job_id: Annotated[str, Path(description="Job ID returned by /transcribe")],
) -> PlainTextResponse:
    """Download the SRT subtitle file for a completed transcription job.

    Returns ``text/plain`` content.  Returns 404 if the job is unknown and
    409 if the job has not finished yet.
    """
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    if job.status != JobStatus.done:
        raise HTTPException(
            status_code=409,
            detail=f"Job is not complete yet (status: {job.status})",
        )
    return PlainTextResponse(
        content=job.srt_content,
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{job_id}.srt"'},
    )
