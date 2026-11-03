import { useEffect } from "react";
import { create } from "zustand";
import { API_BASE } from "./api";
import type { Job } from "./types";

type EventsState = {
  connected: boolean;
  jobs: Record<string, Job>;
  upsert: (job: Job) => void;
  setConnected: (value: boolean) => void;
};

export const useEvents = create<EventsState>((set) => ({
  connected: false,
  jobs: {},
  upsert: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: { ...s.jobs[job.id], ...job } } })),
  setConnected: (connected) => set({ connected }),
}));

type Listener = (event: { type: string; [key: string]: unknown }) => void;
const listeners = new Set<Listener>();

export function onEvent(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let source: EventSource | null = null;

export function connectEvents() {
  if (source) return;
  source = new EventSource(`${API_BASE}/api/events`);
  source.onopen = () => useEvents.getState().setConnected(true);
  source.onerror = () => useEvents.getState().setConnected(false);
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      if (event.type === "job") useEvents.getState().upsert(event as Job);
      listeners.forEach((listener) => listener(event));
    } catch {
      /* ignore malformed */
    }
  };
}

export function useJob(id: string | null | undefined): Job | undefined {
  return useEvents((s) => (id ? s.jobs[id] : undefined));
}

export function useRunningJobs(): Job[] {
  const jobs = useEvents((s) => s.jobs);
  return Object.values(jobs).filter((j) => j.status === "running" || j.status === "queued");
}

export function useEventListener(listener: Listener, deps: unknown[] = []) {
  useEffect(() => onEvent(listener), deps);
}
