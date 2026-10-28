import {
  AlertCircle,
  CheckCircle2,
  Inbox,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export function ErrorState({
  error,
  retry,
  compact = false,
}: {
  error: unknown;
  retry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800 ${compact ? "p-3" : "p-5"}`}
    >
      <AlertCircle size={19} className="shrink-0" />
      <span className="min-w-0 flex-1 break-words">
        {error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."}
      </span>
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold hover:bg-red-100"
        >
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function LoadingState({
  label = "Loading your workspace…",
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      className="flex min-h-52 items-center justify-center gap-3 text-sm text-slate-500"
    >
      <Loader2 size={20} className="animate-spin text-brand-600" />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-16 text-center">
      <div className="mb-4 rounded-2xl border border-brand-100 bg-brand-50 p-4 text-brand-600">
        <Inbox size={27} strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; id: number } | null>(
    null,
  );
  const notify = useCallback(
    (message: string) => setToast({ message, id: Date.now() }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        className="fixed bottom-6 right-4 z-[80] max-w-[calc(100vw-2rem)] sm:right-6"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast && (
          <div className="flex items-center gap-3 rounded-xl border border-brand-100 bg-white p-4 text-sm font-medium text-ink shadow-lg">
            <CheckCircle2 size={20} className="shrink-0 text-brand-600" />
            {toast.message}
            <button
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
              className="icon-button ml-3"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
