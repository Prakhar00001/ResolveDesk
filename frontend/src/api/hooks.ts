import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "./client";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: ({ signal }) => api.agents(signal),
    staleTime: 60_000,
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: ({ signal }) => api.dashboard(signal),
    refetchInterval: 30_000,
  });
}

export function useRefreshTickets() {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["tickets"] }),
      client.invalidateQueries({ queryKey: ["ticket"] }),
      client.invalidateQueries({ queryKey: ["entries"] }),
      client.invalidateQueries({ queryKey: ["activities"] }),
      client.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  }, [client]);
}
