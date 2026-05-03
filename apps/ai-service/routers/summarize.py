"""Video summarization router.

Endpoints
---------
POST /api/summarize/video
    Accept a file path (+ optional pre-computed subtitles), enqueue a
    background summarization job, return job id.

GET /api/summarize/jobs/{job_id}
    Poll job status and retrieve summary results.

Pipeline
--------
1. If ``subtitles`` are provided in the request, skip FUNASR.
2. Otherwise, run FUNASR transcription first (holds 1 GPU slot).
3. Run LM Studio summarization (holds 1 GPU slot).

Steps 1 and 2 are sequential within the same job so they never hold 2 slots
simultaneously.  Two *different* jobs can overlap (1 GPU slot each), which
is the intended max-2 concurrent GPU tasks behaviour.
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Path

from datetime import datetime, timezone

from models.schemas import (
    JobStatus,
    SubtitleSegment,
    SummarizeJob,
    SummarizeJobQueued,
    SummarizeJobResult,
    SummarizeJobsListResponse,
    SummarizeRequest,
)
from services.funasr_service import funasr_service
from services.lmstudio_service import lmstudio_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/summarize", tags=["summarize"])

# In-memory job store: job_id -> SummarizeJob
_jobs: dict[str, SummarizeJob] = {}


# ---------------------------------------------------------------------------
# Background task
# ---------------------------------------------------------------------------


async def _run_summarize(job_id: str) -> None:
    """Execute the full summarize pipeline for *job_id*.

    Pipeline:
    1. Transcribe (if subtitles not pre-supplied) — 1 GPU slot.
    2. Call LM Studio — 1 GPU slot.
    """
    job = _jobs.get(job_id)
    if job is None:
        logger.error("Summarize task started for unknown job_id: %s", job_id)
        return

    job.status = JobStatus.processing
    job.updated_at = datetime.now(timezone.utc)
    logger.info("Summarize job %s started for: %s", job_id, job.file_path)

    # ------------------------------------------------------------------
    # Step 1: Transcription (skip if caller provided subtitles)
    # ------------------------------------------------------------------
    segments: list[SubtitleSegment]

    if job.subtitles:
        segments = job.subtitles
        logger.info(
            "Summarize job %s: using %d pre-supplied subtitle segments",
            job_id,
            len(segments),
        )
    else:
        logger.info("Summarize job %s: running FUNASR transcription first…", job_id)
        try:
            segments = await funasr_service.transcribe(
                file_path=job.file_path,
                language="auto",
            )
            logger.info(
                "Summarize job %s: transcription done — %d segments",
                job_id,
                len(segments),
            )
        except FileNotFoundError as exc:
            job.status = JobStatus.failed
            job.error = str(exc)
            logger.warning(
                "Summarize job %s failed at transcription (file not found): %s",
                job_id,
                exc,
            )
            return
        except Exception as exc:
            job.status = JobStatus.failed
            job.error = f"Transcription error: {exc}"
            logger.exception(
                "Summarize job %s failed at transcription: %s", job_id, exc
            )
            return

    if not segments:
        job.status = JobStatus.failed
        job.error = "No subtitles could be extracted from the file."
        job.updated_at = datetime.now(timezone.utc)
        logger.warning("Summarize job %s: no segments after transcription", job_id)
        return

    # ------------------------------------------------------------------
    # Step 2: LLM summarization
    # ------------------------------------------------------------------
    logger.info("Summarize job %s: calling LM Studio…", job_id)
    try:
        result = await lmstudio_service.summarize(
            segments=segments,
            title=job.title,
            language=job.language,
        )
        job.summary = result.get("summary", "")
        job.key_points = result.get("key_points", [])
        job.topic = result.get("topic", "")
        job.status = JobStatus.done
        logger.info("Summarize job %s done.", job_id)
    except Exception as exc:
        job.status = JobStatus.failed
        job.error = f"LLM summarization error: {exc}"
        logger.exception("Summarize job %s failed at LLM step: %s", job_id, exc)
    finally:
        job.updated_at = datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/video", response_model=SummarizeJobQueued, status_code=202)
async def summarize_video(
    request: SummarizeRequest,
    background_tasks: BackgroundTasks,
) -> SummarizeJobQueued:
    """Accept a video file path and start an async summarization job.

    If ``subtitles`` are provided the FUNASR step is skipped.  Returns
    immediately with a ``job_id`` that can be polled via
    ``GET /api/summarize/jobs/{job_id}``.
    """
    job_id = str(uuid.uuid4())
    job = SummarizeJob(
        job_id=job_id,
        file_path=request.file_path,
        title=request.title,
        subtitles=request.subtitles,
        language=request.language,
    )
    _jobs[job_id] = job

    background_tasks.add_task(_run_summarize, job_id)

    logger.info(
        "Summarize job %s queued for: %s (pre-subtitles=%s, lang=%s)",
        job_id,
        request.file_path,
        request.subtitles is not None,
        request.language,
    )
    return SummarizeJobQueued(job_id=job_id, status=JobStatus.queued)


@router.get("/jobs", response_model=SummarizeJobsListResponse)
async def list_jobs() -> SummarizeJobsListResponse:
    """Return every summarize job, newest first."""
    items = sorted(
        (job.to_result() for job in _jobs.values()),
        key=lambda j: j.created_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return SummarizeJobsListResponse(items=items, total=len(items))


@router.get("/jobs/{job_id}", response_model=SummarizeJobResult)
async def get_job(
    job_id: Annotated[str, Path(description="Job ID returned by /video")],
) -> SummarizeJobResult:
    """Poll the status and results of a summarization job."""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return job.to_result()
