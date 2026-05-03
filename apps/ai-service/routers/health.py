"""Health check router."""

from __future__ import annotations

from fastapi import APIRouter

from models.schemas import HealthResponse
from services.gpu_manager import gpu_manager

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Return service health and current GPU slot utilisation."""
    return HealthResponse(
        status="ok",
        gpu_slots_used=gpu_manager.slots_used,
        gpu_slots_total=gpu_manager.total_slots,
    )
