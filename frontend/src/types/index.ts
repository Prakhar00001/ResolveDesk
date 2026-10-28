export const STATUSES = [
  "Open",
  "In Progress",
  "Waiting on Customer",
  "Resolved",
] as const;
export const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type EntryType = "Public Reply" | "Internal Note";

export interface Agent {
  id: number;
  name: string;
  email: string;
}

export interface Ticket {
  id: number;
  subject: string;
  customer_name: string;
  customer_email: string;
  description: string;
  priority: Priority;
  status: Status;
  assignee_id: number | null;
  assignee: Agent | null;
  created_at: string;
  updated_at: string;
}

export interface Entry {
  id: number;
  ticket_id: number;
  content: string;
  author: string;
  entry_type: EntryType;
  created_at: string;
}

export interface Activity {
  id: number;
  ticket_id: number;
  event_type: string;
  description: string;
  actor: string;
  created_at: string;
}

export interface TicketDetail extends Ticket {
  entries: Entry[];
  activities: Activity[];
}

export interface Dashboard {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  urgent: number;
  overdue: number;
}

export interface TicketFields {
  subject: string;
  customer_name: string;
  customer_email: string;
  description: string;
  priority: Priority;
  status: Status;
  assignee_id: number | null;
}

export type TicketPatch = Partial<TicketFields> & { actor?: string };
export interface EntryInput {
  content: string;
  author: string;
  entry_type: EntryType;
}

export interface TicketFilters {
  search: string;
  status: string;
  priority: string;
  assignee_id: string;
  sort: "updated" | "priority";
}
