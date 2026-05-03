"""GPU concurrency manager.

Wraps a single asyncio.Semaphore so that at most ``GPU_SLOTS`` (default 2)
GPU-bound tasks run concurrently.  Both FUNASR inference and active LM Studio
HTTP requests acquire this semaphore, giving a unified backpressure mechanism
across both GPU consumers.

Usage
-----
::

    from services.gpu_manager import gpu_manager

    async with gpu_manager.acquire():
        result = await some_gpu_bound_coroutine()

The :attr:`slots_used` property returns the number of currently held slots,
which is exposed via the ``/health`` endpoint.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

logger = logging.getLogger(__name__)


class GPUManager:
    """Manages a pool of GPU execution slots via an :class:`asyncio.Semaphore`.

    Parameters
    ----------
    total_slots:
        Maximum number of concurrent GPU tasks allowed.  Reads from the
        ``GPU_SLOTS`` environment variable; falls back to ``2``.
    """

    def __init__(self, total_slots: int | None = None) -> None:
        self._total: int = total_slots if total_slots is not None else int(
            os.getenv("GPU_SLOTS", "2")
        )
        self._semaphore: asyncio.Semaphore = asyncio.Semaphore(self._total)
        # Track usage via a simple counter protected by a lock.
        self._used: int = 0
        self._lock: asyncio.Lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    @property
    def total_slots(self) -> int:
        """Total GPU slots configured."""
        return self._total

    @property
    def slots_used(self) -> int:
        """Number of GPU slots currently in use (snapshot; may lag slightly)."""
        return self._used

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        """Async context manager that acquires one GPU slot.

        Blocks until a slot is available, increments the in-use counter,
        yields control, then releases the slot on exit.

        Example
        -------
        ::

            async with gpu_manager.acquire():
                ...  # GPU work here
        """
        logger.debug(
            "Waiting for GPU slot (%d/%d in use)", self._used, self._total
        )
        async with self._semaphore:
            async with self._lock:
                self._used += 1
            logger.debug(
                "GPU slot acquired (%d/%d in use)", self._used, self._total
            )
            try:
                yield
            finally:
                async with self._lock:
                    self._used -= 1
                logger.debug(
                    "GPU slot released (%d/%d in use)", self._used, self._total
                )


# Module-level singleton.  Routers and services import this directly.
gpu_manager = GPUManager()
