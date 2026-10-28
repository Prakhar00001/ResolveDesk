import { useMutation } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { useRefreshTickets } from "../api/hooks";
import type { Ticket, TicketFields } from "../types";
import {
  changedFields,
  normalizeFields,
  validateTicket,
} from "../utils/formatters";
import { ErrorState, useToast } from "./Feedback";
import Modal from "./Modal";
import TicketFieldsForm from "./TicketFieldsForm";

export function fieldsFromTicket(ticket: Ticket): TicketFields {
  return {
    subject: ticket.subject,
    description: ticket.description,
    customer_name: ticket.customer_name || "",
    customer_email: ticket.customer_email || "",
    status: ticket.status,
    priority: ticket.priority,
    assignee_id: ticket.assignee_id,
  };
}

export default function EditTicketModal({
  ticket,
  actor,
  onClose,
}: {
  ticket: Ticket;
  actor: string;
  onClose: () => void;
}) {
  const [original] = useState(() => fieldsFromTicket(ticket));
  const [fields, setFields] = useState(original);
  const [validation, setValidation] = useState<string | null>(null);
  const refresh = useRefreshTickets();
  const notify = useToast();
  const patch = changedFields(original, normalizeFields(fields));
  const dirty = Object.keys(patch).length > 0;
  const update = useMutation({
    mutationFn: () =>
      api.updateTicket(ticket.id, {
        ...patch,
        ...(actor.trim() ? { actor: actor.trim() } : {}),
      }),
    onSuccess: async () => {
      await refresh();
      notify("Ticket details updated");
      onClose();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const error = validateTicket(fields);
    setValidation(error);
    if (!error && dirty) update.mutate();
  }
  return (
    <Modal
      title={`Edit ticket #${ticket.id}`}
      description="Keep the details clear and your team up to date."
      onClose={onClose}
      busy={update.isPending}
    >
      <form onSubmit={submit} className="p-6">
        <TicketFieldsForm
          value={fields}
          onChange={(next) => {
            setFields(next);
            setValidation(null);
          }}
          disabled={update.isPending}
        />
        {(validation || update.isError) && (
          <div className="mt-5">
            <ErrorState
              compact
              error={validation ? new Error(validation) : update.error}
            />
          </div>
        )}
        <div className="mt-7 flex justify-end gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            className="btn-secondary"
            disabled={update.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn-primary" disabled={!dirty || update.isPending}>
            {update.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            {update.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
