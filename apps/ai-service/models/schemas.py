"""Pydantic schemas for request/response models."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared enums
# ---------------------------------------------------------------------------


class JobStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    done = "done"
    failed = "failed"


# ---------------------------------------------------------------------------
# Subtitle schemas
# ---------------------------------------------------------------------------


class SubtitleSegment(BaseModel):
    """A single subtitle segment with start/end timestamps and text."""

    start: float = Field(..., description="Start time in seconds")
    end: float = Field(..., description="End time in seconds")
    text: str = Field(..., description="Transcribed text for this segment")


class TranscribeRequest(BaseModel):
    """Request body for the transcription endpoint."""

    file_path: str = Field(
        ...,
        description="Absolute path to the video (or audio) file to transcribe",
    )
    language: str = Field(
        default="auto",
        description="Target language: 'auto', 'zh', or 'en'",
    )


class TranscribeJobQueued(BaseModel):
    """Immediate response returned when a transcription job is accepted."""

    job_id: str
    status: JobStatus = JobStatus.queued


class SubtitleJobResult(BaseModel):
    """Full job status/result for a transcription job."""

    job_id: str
    status: JobStatus
    subtitles: list[SubtitleSegment] = Field(default_factory=list)
    srt_content: str = Field(default="")
    error: str | None = None


# ---------------------------------------------------------------------------
# Summarize schemas
# ---------------------------------------------------------------------------


class SummarizeRequest(BaseModel):
    """Request body for the video summarization endpoint."""

    file_path: str = Field(
        ...,
        description="Absolute path to the video file",
    )
    title: str | None = Field(
        default=None,
        description="Optional video title to include in the prompt",
    )
    subtitles: list[SubtitleSegment] | None = Field(
        default=None,
        description="Pre-computed subtitles; if omitted FUNASR will be run first",
    )
    language: str = Field(
        default="zh",
        description="Output language for the summary (zh or en)",
    )


class SummarizeJobQueued(BaseModel):
    """Immediate response returned when a summarization job is accepted."""

    job_id: str
    status: JobStatus = JobStatus.queued


class SummarizeJobResult(BaseModel):
    """Full job status/result for a summarization job."""

    job_id: str
    status: JobStatus
    summary: str = Field(default="")
    key_points: list[str] = Field(default_factory=list)
    topic: str = Field(default="")
    error: str | None = None


# ---------------------------------------------------------------------------
# Health schema
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "ok"
    gpu_slots_used: int
    gpu_slots_total: int


# ---------------------------------------------------------------------------
# Internal job store types (not exposed via API)
# ---------------------------------------------------------------------------


class SubtitleJob(BaseModel):
    """Internal representation of a subtitle job stored in memory."""

    job_id: str
    status: JobStatus = JobStatus.queued
    file_path: str
    language: str = "auto"
    subtitles: list[SubtitleSegment] = Field(default_factory=list)
    srt_content: str = ""
    error: str | None = None

    model_config = {"arbitrary_types_allowed": True}

    def to_result(self) -> SubtitleJobResult:
        return SubtitleJobResult(
            job_id=self.job_id,
            status=self.status,
            subtitles=self.subtitles,
            srt_content=self.srt_content,
            error=self.error,
        )


class SummarizeJob(BaseModel):
    """Internal representation of a summarize job stored in memory."""

    job_id: str
    status: JobStatus = JobStatus.queued
    file_path: str
    title: str | None = None
    subtitles: list[SubtitleSegment] | None = None
    language: str = "zh"
    summary: str = ""
    key_points: list[str] = Field(default_factory=list)
    topic: str = ""
    error: str | None = None

    model_config = {"arbitrary_types_allowed": True}

    def to_result(self) -> SummarizeJobResult:
        return SummarizeJobResult(
            job_id=self.job_id,
            status=self.status,
            summary=self.summary,
            key_points=self.key_points,
            topic=self.topic,
            error=self.error,
        )
