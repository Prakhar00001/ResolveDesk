import { useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import CreateTicketModal from "./components/CreateTicketModal";
import { EmptyState, ToastProvider } from "./components/Feedback";
import Layout from "./components/Layout";
import TicketDashboardPage from "./pages/TicketDashboardPage";
import TicketDetailPage from "./pages/TicketDetailPage";

export default function App() {
  const [creating, setCreating] = useState(false);
  return (
    <ToastProvider>
      <Routes>
        <Route element={<Layout onCreate={() => setCreating(true)} />}>
          <Route
            index
            element={<TicketDashboardPage onCreate={() => setCreating(true)} />}
          />
          <Route
            path="tickets"
            element={<TicketDashboardPage onCreate={() => setCreating(true)} />}
          />
          <Route path="tickets/:id" element={<TicketDetailPage />} />
          <Route
            path="*"
            element={
              <EmptyState
                title="This page wandered off"
                description="Head back to your inbox to find what you're looking for."
                action={
                  <Link to="/tickets" className="btn-primary">
                    Back to tickets
                  </Link>
                }
              />
            }
          />
        </Route>
      </Routes>
      {creating && <CreateTicketModal onClose={() => setCreating(false)} />}
    </ToastProvider>
  );
}
