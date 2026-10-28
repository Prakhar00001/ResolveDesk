"""Non-destructive demo data: python -m app.db.seed."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db.database import SessionLocal, init_database
from app.models.models import Activity, Agent, Entry, Ticket

AGENTS = (
    ("Maya Chen", "maya@resolvedesk.example"),
    ("Jordan Lee", "jordan@resolvedesk.example"),
    ("Sam Rivera", "sam@resolvedesk.example"),
)
SUBJECTS = (
    "Unable to sign in after password reset", "Invoice total looks incorrect",
    "Export report missing recent records", "How do I invite a teammate?",
    "Payment declined during renewal", "Dashboard loading slowly",
    "Update billing contact", "Webhook delivery failing",
    "Request for dark mode", "Account access restored",
    "Duplicate subscription charge refunded", "API integration setup complete",
)


def seed(session_factory=SessionLocal, now=None):
    now = now or datetime.now(timezone.utc)
    with session_factory() as db:
        agents = []
        for name, email in AGENTS:
            agent = db.scalar(select(Agent).where(Agent.email == email))
            if agent is None:
                agent = Agent(name=name, email=email)
                db.add(agent)
                db.flush()
            agents.append(agent)
        added = 0
        for index, subject in enumerate(SUBJECTS):
            key = f"demo-v1-{index + 1}"
            # Include soft-deleted rows so rerunning never resurrects a ticket.
            if db.scalar(select(Ticket.id).where(Ticket.seed_key == key)) is not None:
                continue
            created = now - timedelta(hours=(index + 1) * 7)
            status = ("Open", "In Progress", "Waiting on Customer")[index % 3] if index < 9 else "Resolved"
            ticket = Ticket(
                seed_key=key, subject=subject, customer_name=f"Demo Customer {index + 1}",
                customer_email=f"customer{index + 1}@example.com",
                description=f"Customer reported: {subject.lower()}. Please investigate and follow up.",
                priority=("Low", "Medium", "High", "Urgent")[index % 4], status=status,
                assignee_id=agents[index % 3].id if index % 4 else None,
                created_at=created, updated_at=created + timedelta(hours=2),
            )
            db.add(ticket)
            db.flush()
            db.add(Activity(ticket_id=ticket.id, event_type="ticket_created", description="Ticket created", actor="Support Team", created_at=created))
            for offset, entry_type, content in (
                (1, "Public Reply", "Thanks for contacting us. We are reviewing your request."),
                (2, "Internal Note", "Checked the account history; follow up with the customer."),
            ):
                timestamp = created + timedelta(hours=offset)
                author = agents[index % 3].name
                db.add(Entry(ticket_id=ticket.id, content=content, author=author, entry_type=entry_type, created_at=timestamp))
                db.add(Activity(ticket_id=ticket.id, event_type="reply_added" if offset == 1 else "note_added", description=f"{entry_type} added", actor=author, created_at=timestamp))
            added += 1
        db.commit()
        return added


if __name__ == "__main__":
    init_database()
    print(f"Added {seed()} demo tickets; existing records were preserved.")
