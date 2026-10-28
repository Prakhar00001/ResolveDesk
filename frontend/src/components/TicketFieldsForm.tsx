import { useId } from "react";
import { useAgents } from "../api/hooks";
import { PRIORITIES, STATUSES, type TicketFields } from "../types";
import { ErrorState } from "./Feedback";

export default function TicketFieldsForm({
  value,
  onChange,
  disabled = false,
}: {
  value: TicketFields;
  onChange: (fields: TicketFields) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const agents = useAgents();
  function set<K extends keyof TicketFields>(key: K, next: TicketFields[K]) {
    onChange({ ...value, [key]: next });
  }
  return (
    <fieldset disabled={disabled} className="space-y-5 disabled:opacity-70">
      <div>
        <label htmlFor={`${id}-subject`} className="field-label">
          Subject <span className="text-rose-500">*</span>
        </label>
        <input
          data-autofocus
          id={`${id}-subject`}
          value={value.subject}
          onChange={(e) => set("subject", e.target.value)}
          required
          maxLength={255}
          placeholder="A short summary of the issue"
          className="input"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`} className="field-label">
            Customer name
          </label>
          <input
            id={`${id}-name`}
            value={value.customer_name}
            onChange={(e) => set("customer_name", e.target.value)}
            maxLength={120}
            placeholder="e.g. Alex Morgan"
            className="input"
            aria-describedby={`${id}-customer-hint`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-email`} className="field-label">
            Customer email
          </label>
          <input
            id={`${id}-email`}
            type="email"
            value={value.customer_email}
            onChange={(e) => set("customer_email", e.target.value)}
            maxLength={254}
            placeholder="alex@company.com"
            className="input"
            aria-describedby={`${id}-customer-hint`}
          />
        </div>
      </div>
      <p id={`${id}-customer-hint`} className="!mt-2 text-xs text-slate-500">
        Provide at least a customer name or email address.
      </p>
      <div>
        <label htmlFor={`${id}-description`} className="field-label">
          Description <span className="text-rose-500">*</span>
        </label>
        <textarea
          id={`${id}-description`}
          rows={5}
          value={value.description}
          onChange={(e) => set("description", e.target.value)}
          required
          placeholder="What happened? Include any details that could help your team."
          className="input resize-y"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={`${id}-status`} className="field-label">
            Status
          </label>
          <select
            id={`${id}-status`}
            className="input"
            value={value.status}
            onChange={(e) =>
              set("status", e.target.value as TicketFields["status"])
            }
          >
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-priority`} className="field-label">
            Priority
          </label>
          <select
            id={`${id}-priority`}
            className="input"
            value={value.priority}
            onChange={(e) =>
              set("priority", e.target.value as TicketFields["priority"])
            }
          >
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-assignee`} className="field-label">
            Assignee
          </label>
          <select
            id={`${id}-assignee`}
            className="input"
            value={value.assignee_id ?? ""}
            disabled={agents.isPending || agents.isError}
            onChange={(e) =>
              set("assignee_id", e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">
              {agents.isPending ? "Loading agents…" : "Unassigned"}
            </option>
            {value.assignee_id !== null &&
              !agents.data?.some((agent) => agent.id === value.assignee_id) && (
                <option value={value.assignee_id}>
                  Current assignee (#{value.assignee_id})
                </option>
              )}
            {agents.data?.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {agents.isError && (
        <ErrorState
          compact
          error={agents.error}
          retry={() => void agents.refetch()}
        />
      )}
    </fieldset>
  );
}
