from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.models import Agent
from app.schemas.schemas import (
    ActivityOut, AgentOut, DashboardOut, EntryCreate, EntryOut, Priority, Status,
    TicketCreate, TicketDetail, TicketOut, TicketPatch,
)
from app.services import ticket_service as service

router = APIRouter(prefix="/api")
DB = Annotated[Session, Depends(get_db)]
Now = Annotated[datetime, Depends(service.get_now)]


@router.get("/agents", response_model=list[AgentOut])
def agents(db: DB):
    return db.scalars(select(Agent).order_by(Agent.name, Agent.id)).all()


@router.get("/tickets", response_model=list[TicketOut])
def tickets(db: DB, search: str | None = None, status: Status | None = None,
            priority: Priority | None = None, assignee_id: Annotated[int | None, Query(gt=0)] = None,
            sort: Literal["updated", "priority"] = "updated"):
    return service.list_tickets(db, search, status, priority, assignee_id, sort)


@router.post("/tickets", response_model=TicketOut, status_code=201)
def create_ticket(payload: TicketCreate, db: DB, now: Now):
    return service.create_ticket(db, payload, now)


@router.get("/tickets/{ticket_id}", response_model=TicketDetail)
def ticket_detail(ticket_id: int, db: DB):
    return service.get_ticket(db, ticket_id)


@router.patch("/tickets/{ticket_id}", response_model=TicketOut)
def patch_ticket(ticket_id: int, payload: TicketPatch, db: DB, now: Now):
    return service.patch_ticket(db, ticket_id, payload, now)


@router.delete("/tickets/{ticket_id}", status_code=204)
def delete_ticket(ticket_id: int, db: DB, now: Now,
                  actor: Annotated[str, Query(min_length=1, max_length=120, pattern=r"\S")] = "Support Team"):
    service.delete_ticket(db, ticket_id, actor, now)
    return Response(status_code=204)


@router.get("/tickets/{ticket_id}/entries", response_model=list[EntryOut])
def entries(ticket_id: int, db: DB):
    return service.get_ticket(db, ticket_id).entries


@router.post("/tickets/{ticket_id}/entries", response_model=EntryOut, status_code=201)
def create_entry(ticket_id: int, payload: EntryCreate, db: DB, now: Now):
    return service.create_entry(db, ticket_id, payload, now)


@router.get("/tickets/{ticket_id}/activities", response_model=list[ActivityOut])
def activities(ticket_id: int, db: DB):
    return service.get_ticket(db, ticket_id).activities


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: DB, now: Now):
    return service.dashboard(db, now)
