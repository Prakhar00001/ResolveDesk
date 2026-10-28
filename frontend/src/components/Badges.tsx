import {
  ArrowDown,
  ArrowUp,
  Circle,
  CircleCheck,
  CircleDot,
  Clock3,
  Minus,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Priority, Status } from "../types";
import { exactTime, initials, relativeTime } from "../utils/formatters";

const statusStyles: Record<Status, string> = {
  Open: "bg-blue-50 text-blue-700 ring-blue-100",
  "In Progress": "bg-amber-50 text-amber-700 ring-amber-100",
  "Waiting on Customer": "bg-violet-50 text-violet-700 ring-violet-100",
  Resolved: "bg-brand-50 text-brand-600 ring-brand-100",
};
const statusIcons = {
  Open: Circle,
  "In Progress": CircleDot,
  "Waiting on Customer": Clock3,
  Resolved: CircleCheck,
};
const priorityStyles = {
  Low: "text-slate-500",
  Medium: "text-blue-600",
  High: "text-orange-600",
  Urgent: "text-rose-600",
};
const priorityIcons = {
  Low: ArrowDown,
  Medium: Minus,
  High: ArrowUp,
  Urgent: Zap,
};

export function StatusBadge({ status }: { status: Status }) {
  const Icon = statusIcons[status] || Circle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusStyles[status] || "bg-slate-100 text-slate-600"}`}
    >
      <Icon size={12} />
      {status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const Icon = priorityIcons[priority] || Minus;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${priorityStyles[priority] || "text-slate-500"}`}
    >
      <Icon size={14} strokeWidth={2.4} />
      {priority}
    </span>
  );
}

export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700 ring-1 ring-inset ring-brand-100 ${small ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs"}`}
    >
      {initials(name)}
    </span>
  );
}

export function Timestamp({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time
      dateTime={value}
      title={exactTime(value)}
      aria-label={exactTime(value)}
      tabIndex={0}
      className={`timestamp ${className}`}
    >
      {relativeTime(value)}
      <span role="tooltip" className="timestamp-tooltip">
        {exactTime(value)}
      </span>
    </time>
  );
}
