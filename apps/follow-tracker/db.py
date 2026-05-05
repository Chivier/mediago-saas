"""SQLite schema + thread-safe access.

Two tables:

* ``creators`` — the list of UPs / channels we follow. Multi-platform
  via the ``platform`` discriminator (``bilibili`` or ``youtube``).
* ``videos`` — every distinct video we've ever discovered for any
  creator. ``status`` advances ``discovered → queued → succeeded |
  failed | skipped`` and ``download_id`` links it to a row in mediago-core's
  videos table once we've enqueued it. The AI pipeline writes
  ``ai_status`` / ``ai_job_id`` independently.

The DB is small — a thousand rows per UP is the natural ceiling — so a
plain SQLAlchemy 2.x synchronous engine is plenty. We just guard with a
thread-pool offload from FastAPI handlers via ``asyncio.to_thread`` to
keep the event loop free.
"""

from __future__ import annotations

import datetime as dt
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    inspect,
    select,
    text,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
)

from config import DB_PATH


class Base(DeclarativeBase):
    pass


def _utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Creator(Base):
    __tablename__ = "creators"

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    # Bilibili: numeric mid as string. YouTube: channel_id (UCxxxx…).
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    auto_download: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # Optional per-creator auth cookies. Bilibili's risk-control rejects
    # anonymous WBI calls and paid videos require a logged-in SESSDATA;
    # stored as the raw "k=v; k=v" cookie string the user pastes from
    # browser DevTools so we don't tie the format to one platform.
    cookies: Mapped[Optional[str]] = mapped_column(Text)
    # Free-form labels for organizing creators in the UI. Stored as a
    # JSON array of strings — e.g. ["哲学", "电影解说"]. NULL means
    # "no tags". Kept as Text + JSON to avoid pulling in a separate
    # tags table for what is essentially a per-creator chip list.
    tags: Mapped[Optional[str]] = mapped_column(Text)
    last_checked_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    videos: Mapped[list["Video"]] = relationship(
        back_populates="creator",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class PlatformCredential(Base):
    """Platform-level login cookies — one row per platform.

    Acts as the *default* cookie blob for any creator on that platform
    that doesn't have its own ``Creator.cookies`` override. Set via the
    QR-scan flow on the Subscriptions page; falls through to the legacy
    ``BILI_SESSDATA`` env var when the row is missing.
    """

    __tablename__ = "platform_credentials"

    platform: Mapped[str] = mapped_column(String(16), primary_key=True)
    cookies: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[int] = mapped_column(primary_key=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("creators.id", ondelete="CASCADE"), nullable=False)
    # bvid for Bilibili, video id for YouTube. Unique per (creator, external_id).
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    url: Mapped[str] = mapped_column(Text, nullable=False)
    pub_date: Mapped[Optional[str]] = mapped_column(String(64))
    duration: Mapped[Optional[str]] = mapped_column(String(32))
    cover_url: Mapped[Optional[str]] = mapped_column(Text)
    # discovered | queued | succeeded | failed | skipped
    status: Mapped[str] = mapped_column(String(16), default="discovered", nullable=False)
    download_id: Mapped[Optional[int]] = mapped_column(Integer)
    file_path: Mapped[Optional[str]] = mapped_column(Text)
    failure_category: Mapped[Optional[str]] = mapped_column(String(64))
    failure_reason: Mapped[Optional[str]] = mapped_column(Text)
    failure_log_excerpt: Mapped[Optional[str]] = mapped_column(Text)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_retry_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True))
    # When the actual downloaded duration is materially shorter than the
    # creator-reported video duration, the upload is almost always paid /
    # member-only and BBDown only got the preview snippet. Surfaced in
    # the UI so the user can decide to repurchase or skip.
    is_paid_preview: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    actual_duration_seconds: Mapped[Optional[int]] = mapped_column(Integer)
    # pending | processing | done | failed
    ai_status: Mapped[Optional[str]] = mapped_column(String(16))
    ai_job_id: Mapped[Optional[str]] = mapped_column(String(64))
    notes_json: Mapped[Optional[str]] = mapped_column(Text)
    discovered_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    creator: Mapped[Creator] = relationship(back_populates="videos")


_engine = create_engine(f"sqlite:///{DB_PATH}", future=True, echo=False)
_SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(_engine)
    _migrate()


def _migrate() -> None:
    """Best-effort additive migrations for older SQLite files.

    SQLAlchemy's create_all only creates missing tables; new columns on
    existing tables need an explicit ALTER. Idempotent — safe to run on
    every startup.
    """
    inspector = inspect(_engine)
    tables = inspector.get_table_names()
    if "creators" in tables:
        have = {col["name"] for col in inspector.get_columns("creators")}
        with _engine.begin() as conn:
            if "cookies" not in have:
                conn.execute(text("ALTER TABLE creators ADD COLUMN cookies TEXT"))
            if "tags" not in have:
                conn.execute(text("ALTER TABLE creators ADD COLUMN tags TEXT"))
    if "videos" in tables:
        have = {col["name"] for col in inspector.get_columns("videos")}
        with _engine.begin() as conn:
            if "failure_category" not in have:
                conn.execute(text("ALTER TABLE videos ADD COLUMN failure_category TEXT"))
            if "failure_reason" not in have:
                conn.execute(text("ALTER TABLE videos ADD COLUMN failure_reason TEXT"))
            if "failure_log_excerpt" not in have:
                conn.execute(text("ALTER TABLE videos ADD COLUMN failure_log_excerpt TEXT"))
            if "retry_count" not in have:
                conn.execute(
                    text(
                        "ALTER TABLE videos ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0"
                    )
                )
            if "last_retry_at" not in have:
                conn.execute(text("ALTER TABLE videos ADD COLUMN last_retry_at DATETIME"))
            if "is_paid_preview" not in have:
                conn.execute(
                    text(
                        "ALTER TABLE videos ADD COLUMN is_paid_preview INTEGER NOT NULL DEFAULT 0"
                    )
                )
            if "actual_duration_seconds" not in have:
                conn.execute(
                    text(
                        "ALTER TABLE videos ADD COLUMN actual_duration_seconds INTEGER"
                    )
                )


@contextmanager
def session_scope() -> Iterator[Session]:
    s = _SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_creator(s: Session, creator_id: int) -> Optional[Creator]:
    return s.get(Creator, creator_id)


def find_creator_by_external(s: Session, platform: str, external_id: str) -> Optional[Creator]:
    return s.scalars(
        select(Creator).where(Creator.platform == platform, Creator.external_id == external_id)
    ).first()


def find_video(s: Session, creator_id: int, external_id: str) -> Optional[Video]:
    return s.scalars(
        select(Video).where(Video.creator_id == creator_id, Video.external_id == external_id)
    ).first()
