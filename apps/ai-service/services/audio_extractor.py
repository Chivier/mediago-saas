"""Audio extraction from video files using ffmpeg.

Runs ffmpeg as a subprocess to pull a 16 kHz mono WAV stream from any
container format supported by ffmpeg (MP4, MKV, AVI, MOV, etc.).

The caller is responsible for cleaning up the temporary file after use.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# ffmpeg arguments used for every extraction.
_FFMPEG_AUDIO_ARGS: list[str] = [
    "-vn",           # drop video streams
    "-acodec", "pcm_s16le",  # 16-bit PCM
    "-ar", "16000",  # 16 kHz — required by FUNASR paraformer models
    "-ac", "1",      # mono
]


class AudioExtractionError(Exception):
    """Raised when ffmpeg exits with a non-zero return code."""


async def extract_audio(video_path: str | Path, output_dir: str | Path | None = None) -> str:
    """Extract audio from *video_path* and write a WAV file.

    Parameters
    ----------
    video_path:
        Absolute path to the source video file.
    output_dir:
        Directory where the temporary WAV file will be created.  Defaults to
        the system temporary directory.

    Returns
    -------
    str
        Absolute path to the extracted WAV file.  The caller **must** delete
        this file when it is no longer needed.

    Raises
    ------
    AudioExtractionError
        If ffmpeg exits with a non-zero status code.
    FileNotFoundError
        If *video_path* does not exist.
    """
    video_path = Path(video_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    # Create a named temp file so ffmpeg can write to it.
    suffix = ".wav"
    if output_dir is not None:
        os.makedirs(output_dir, exist_ok=True)
        fd, wav_path = tempfile.mkstemp(suffix=suffix, dir=str(output_dir))
    else:
        fd, wav_path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)  # ffmpeg will overwrite the file; close the fd now.

    cmd: list[str] = [
        "ffmpeg",
        "-y",               # overwrite without prompt
        "-i", str(video_path),
        *_FFMPEG_AUDIO_ARGS,
        wav_path,
    ]

    logger.info("Extracting audio: %s -> %s", video_path.name, wav_path)
    logger.debug("ffmpeg command: %s", " ".join(cmd))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    if proc.returncode != 0:
        # Clean up the empty/partial output file before raising.
        try:
            os.unlink(wav_path)
        except OSError:
            pass
        error_msg = stderr.decode(errors="replace").strip()
        raise AudioExtractionError(
            f"ffmpeg failed (exit {proc.returncode}) for '{video_path}': {error_msg}"
        )

    logger.info("Audio extracted successfully: %s (%.1f KB)", wav_path, os.path.getsize(wav_path) / 1024)
    return wav_path
