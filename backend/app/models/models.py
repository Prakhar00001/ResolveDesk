from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from app.db.database import Base

PRIORITIES = ("Low", "Medium", "High", "Urgent")
STATUSES = ("Open", "In Progress", "Waiting on Customer", "Resolved")
ENTRY_TYPES = ("Public Reply", "Internal Note")


class UTCDateTime(TypeDecorator):
    """SQLite stores naive UTC; always return timezone-aware API values."""
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Timestamps must be timezone-aware")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        return value.replace(tzinfo=timezone.utc) if value is not None else None


class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True)


class Ticket(Base):
    __tablename__ = "tickets"
    __table_args__ = (
        CheckConstraint("priority IN ('Low', 'Medium', 'High', 'Urgent')", name="valid_priority"),
        CheckConstraint("status IN ('Open', 'In Progress', 'Waiting on Customer', 'Resolved')", name="valid_status"),
        CheckConstraint("length(trim(coalesce(customer_name, ''))) > 0 OR length(trim(coalesce(customer_email, ''))) > 0", name="customer_identifier"),
        CheckConstraint("length(trim(subject)) > 0", name="nonempty_subject"),
        CheckConstraint("length(trim(description)) > 0", name="nonempty_description"),
        Index("ix_tickets_deleted_updated", "deleted_at", "updated_at"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    subject: Mapped[str] = mapped_column(String(255))
    customer_name: Mapped[str | None] = mapped_column(String(120))
    customer_email: Mapped[str | None] = mapped_column(String(254))
    description: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(16), default="Medium")
    status: Mapped[str] = mapped_column(String(32), default="Open")
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("agents.id", ondelete="RESTRICT"), index=True)
    assignee: Mapped[Agent | None] = relationship(lazy="joined")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime())
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    seed_key: Mapped[str | None] = mapped_column(String(64), unique=True)
    entries: Mapped[list["Entry"]] = relationship(order_by="(Entry.created_at, Entry.id)")
    activities: Mapped[list["Activity"]] = relationship(order_by="(Activity.created_at, Activity.id)")


class Entry(Base):
    __tablename__ = "entries"
    __table_args__ = (
        CheckConstraint("entry_type IN ('Public Reply', 'Internal Note')", name="valid_entry_type"),
        CheckConstraint("length(trim(content)) > 0", name="nonempty_content"),
        CheckConstraint("length(trim(author)) > 0", name="nonempty_author"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="RESTRICT"), index=True)
    content: Mapped[str] = mapped_column(Text)
    author: Mapped[str] = mapped_column(String(120))
    entry_type: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())


class Activity(Base):
    __tablename__ = "activities"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="RESTRICT"), index=True)
    event_type: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime())
