import { create } from "zustand";
import type { Decision, NumericField } from "./domain";

export type FieldPath = (string | number)[];

type AppStore = {
  decision: Decision | null;
  enabledTagIds: string[];
  simulationVersion: number;
  setDecision: (decision: Decision) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  updateNumeric: (path: FieldPath, field: NumericField) => void;
};

function assignAtPath(decision: Decision, path: FieldPath, field: NumericField): Decision {
  const copy = structuredClone(decision);
  let cursor: unknown = copy;
  for (const key of path.slice(0, -1)) cursor = (cursor as Record<string | number, unknown>)[key];
  (cursor as Record<string | number, unknown>)[path[path.length - 1]] = field;
  return copy;
}

export const useAppStore = create<AppStore>((set) => ({
  decision: null,
  enabledTagIds: [],
  simulationVersion: 0,
  setDecision: (decision) => set({ decision, enabledTagIds: [], simulationVersion: 0 }),
  setEnabled: (id, enabled) => set((state) => ({
    enabledTagIds: enabled
      ? state.enabledTagIds.includes(id) ? state.enabledTagIds : [...state.enabledTagIds, id]
      : state.enabledTagIds.filter((value) => value !== id),
    simulationVersion: state.simulationVersion + 1,
  })),
  updateNumeric: (path, field) => set((state) => ({
    decision: state.decision ? assignAtPath(state.decision, path, field) : null,
    simulationVersion: state.simulationVersion + 1,
  })),
}));
