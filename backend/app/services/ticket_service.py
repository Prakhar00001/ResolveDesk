from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.models.models import Activity, Agent, Entry, Ticket
from app.schemas.schemas import EntryCreate, TicketCreate, TicketPatch


def get_now() -> datetime:
    """FastAPI dependency: override this function for deterministic clocks."""
    return datetime.now(timezone.utc)


def get_ticket(db: Session, ticket_id: int) -> Ticket:
    ticket = db.scalar(select(Ticket).where(Ticket.id == ticket_id, Ticket.deleted_at.is_(None)))
    if ticket is None:
        raise HTTPException(404, "Ticket not found")
    return ticket


def check_assignee(db: Session, assignee_id: int | None):
    if assignee_id is not None and db.get(Agent, assignee_id) is None:
        raise HTTPException(422, "Assignee does not exist")


def record(db, ticket, event_type, description, actor, now):
    db.add(Activity(ticket_id=ticket.id, event_type=event_type, description=description, actor=actor, created_at=now))


def list_tickets(db, search=None, status=None, priority=None, assignee_id=None, sort="updated"):
    query = select(Ticket).where(Ticket.deleted_at.is_(None))
    if search and search.strip():
        # Escape LIKE metacharacters: the search box performs literal substring search.
        term = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{term}%"
        query = query.where(or_(*(column.ilike(pattern, escape="\\") for column in (
            Ticket.subject, Ticket.customer_name, Ticket.customer_email, Ticket.description,
        ))))
    for column, value in ((Ticket.status, status), (Ticket.priority, priority), (Ticket.assignee_id, assignee_id)):
        if value is not None:
            query = query.where(column == value)
    if sort == "priority":
        rank = case({"Urgent": 4, "High": 3, "Medium": 2, "Low": 1}, value=Ticket.priority, else_=0)
        query = query.order_by(rank.desc())
    return db.scalars(query.order_by(Ticket.updated_at.desc(), Ticket.id.desc())).all()


def create_ticket(db: Session, payload: TicketCreate, now):
    check_assignee(db, payload.assignee_id)
    ticket = Ticket(**payload.model_dump(exclude={"actor"}), created_at=now, updated_at=now)
    db.add(ticket)
    db.flush()
    record(db, ticket, "ticket_created", "Ticket created", payload.actor, now)
    db.commit()
    db.refresh(ticket)
    return ticket


def patch_ticket(db: Session, ticket_id: int, payload: TicketPatch, now):
    ticket = get_ticket(db, ticket_id)
    changes = payload.model_dump(exclude_unset=True, exclude={"actor"})
    name = changes.get("customer_name", ticket.customer_name)
    email = changes.get("customer_email", ticket.customer_email)
    if not name and not email:
        raise HTTPException(422, "At least one of customer_name or customer_email is required")
    if "assignee_id" in changes:
        check_assignee(db, changes["assignee_id"])
    changed = False
    for field, value in changes.items():
        old = getattr(ticket, field)
        if old == value:
            continue
        if field == "assignee_id":
            before = db.get(Agent, old).name if old is not None else "Unassigned"
            after = db.get(Agent, value).name if value is not None else "Unassigned"
            description = f"Assignee changed from {before} to {after}"
        else:
            description = f"{field.replace('_', ' ').capitalize()} changed from {old if old is not None else 'Unassigned'} to {value if value is not None else 'Unassigned'}"
        setattr(ticket, field, value)
        record(db, ticket, f"{field}_changed", description, payload.actor, now)
        changed = True
    if changed:
        ticket.updated_at = now
        db.commit()
        db.refresh(ticket)
    return ticket


def delete_ticket(db, ticket_id, actor, now):
    ticket = get_ticket(db, ticket_id)
    ticket.deleted_at = now
    ticket.updated_at = now
    record(db, ticket, "ticket_deleted", "Ticket deleted", actor, now)
    db.commit()


def create_entry(db, ticket_id, payload: EntryCreate, now):
    ticket = get_ticket(db, ticket_id)
    entry = Entry(ticket_id=ticket.id, **payload.model_dump(exclude={"actor"}), created_at=now)
    db.add(entry)
    ticket.updated_at = now
    record(db, ticket, "reply_added" if payload.entry_type == "Public Reply" else "note_added", f"{payload.entry_type} added", payload.actor or payload.author, now)
    db.commit()
    db.refresh(entry)
    return entry


def dashboard(db, now):
    # A single statement gives a consistent snapshot across all six counts.
    conditions = {
        "open": Ticket.status == "Open",
        "in_progress": Ticket.status == "In Progress",
        "resolved": Ticket.status == "Resolved",
        "urgent": Ticket.priority == "Urgent",
        "overdue": (Ticket.status != "Resolved") & (Ticket.created_at < now - timedelta(hours=24)),
    }
    statement = select(func.count(Ticket.id).label("total"), *(
        func.coalesce(func.sum(case((condition, 1), else_=0)), 0).label(name)
        for name, condition in conditions.items()
    )).where(Ticket.deleted_at.is_(None))
    return dict(db.execute(statement).one()._mapping)
