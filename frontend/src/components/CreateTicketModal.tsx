import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useRefreshTickets } from "../api/hooks";
import type { TicketFields } from "../types";
import { normalizeFields, validateTicket } from "../utils/formatters";
import { ErrorState, useToast } from "./Feedback";
import Modal from "./Modal";
import TicketFieldsForm from "./TicketFieldsForm";

export default function CreateTicketModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [fields, setFields] = useState<TicketFields>({
    subject: "",
    customer_name: "",
    customer_email: "",
    description: "",
    priority: "Medium",
    status: "Open",
    assignee_id: null,
  });
  const [validation, setValidation] = useState<string | null>(null);
  const refresh = useRefreshTickets();
  const notify = useToast();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: api.createTicket,
    onSuccess: async (ticket) => {
      await refresh();
      notify(`Ticket #${ticket.id} created successfully`);
      onClose();
      navigate(`/tickets/${ticket.id}`);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const error = validateTicket(fields);
    setValidation(error);
    if (!error) create.mutate(normalizeFields(fields));
  }
  return (
    <Modal
      title="Create a ticket"
      description="Great support starts with the right details."
      onClose={onClose}
      busy={create.isPending}
    >
      <form onSubmit={submit} className="p-6">
        <TicketFieldsForm
          value={fields}
          onChange={(next) => {
            setFields(next);
            setValidation(null);
          }}
          disabled={create.isPending}
        />
        {(validation || create.isError) && (
          <div className="mt-5">
            <ErrorState
              compact
              error={validation ? new Error(validation) : create.error}
            />
          </div>
        )}
        <div className="mt-7 flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            className="btn-secondary"
            disabled={create.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn-primary" disabled={create.isPending}>
            {create.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ArrowUpRight size={16} />
            )}{" "}
            {create.isPending ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
