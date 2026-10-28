from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

Priority = Literal["Low", "Medium", "High", "Urgent"]
Status = Literal["Open", "In Progress", "Waiting on Customer", "Resolved"]
EntryType = Literal["Public Reply", "Internal Note"]
Subject = Annotated[str, Field(min_length=1, max_length=255)]
Description = Annotated[str, Field(min_length=1)]
Name = Annotated[str, Field(min_length=1, max_length=120)]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TicketCreate(InputModel):
    subject: Subject
    customer_name: Name | None = None
    customer_email: EmailStr | None = None
    description: Description
    priority: Priority = "Medium"
    status: Status = "Open"
    assignee_id: Annotated[int, Field(gt=0)] | None = None
    actor: Name = "Support Team"

    @field_validator("customer_name", "customer_email", mode="before")
    @classmethod
    def blank_identifier(cls, value):
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def require_customer(self):
        if not self.customer_name and not self.customer_email:
            raise ValueError("At least one of customer_name or customer_email is required")
        return self


class TicketPatch(InputModel):
    subject: Subject | None = None
    customer_name: Name | None = None
    customer_email: EmailStr | None = None
    description: Description | None = None
    priority: Priority | None = None
    status: Status | None = None
    assignee_id: Annotated[int, Field(gt=0)] | None = None
    actor: Name = "Support Team"

    @field_validator("customer_name", "customer_email", mode="before")
    @classmethod
    def blank_identifier(cls, value):
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def reject_null_required_fields(self):
        for field in ("subject", "description", "priority", "status", "actor"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class EntryCreate(InputModel):
    content: Annotated[str, Field(min_length=1)]
    author: Name = "Support Team"
    entry_type: EntryType = "Public Reply"
    actor: Name | None = None


class OutputModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AgentOut(OutputModel):
    id: int
    name: str
    email: str


class EntryOut(OutputModel):
    id: int
    ticket_id: int
    content: str
    author: str
    entry_type: EntryType
    created_at: datetime


class ActivityOut(OutputModel):
    id: int
    ticket_id: int
    event_type: str
    description: str
    actor: str
    created_at: datetime


class TicketOut(OutputModel):
    id: int
    subject: str
    customer_name: str | None
    customer_email: str | None
    description: str
    priority: Priority
    status: Status
    assignee_id: int | None
    assignee: AgentOut | None
    created_at: datetime
    updated_at: datetime


class TicketDetail(TicketOut):
    entries: list[EntryOut]
    activities: list[ActivityOut]


class DashboardOut(BaseModel):
    total: int
    open: int
    in_progress: int
    resolved: int
    urgent: int
    overdue: int
