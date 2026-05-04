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
    if "creators" not in inspector.get_table_names():
        return
    have = {col["name"] for col in inspector.get_columns("creators")}
    with _engine.begin() as conn:
        if "cookies" not in have:
            conn.execute(text("ALTER TABLE creators ADD COLUMN cookies TEXT"))


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
