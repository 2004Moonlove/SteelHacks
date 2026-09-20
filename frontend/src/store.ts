import { create } from "zustand";
import { isSubscriptionDecision, type Decision, type NumericField } from "./domain";

export type FieldPath = (string | number)[];

type AppStore = {
  decision: Decision | null;
  enabledTagIds: string[];
  simulationVersion: number;
  setDecision: (decision: Decision) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  updateNumeric: (path: FieldPath, field: NumericField) => void;
  setImportance: (tagId: string, importance: number | undefined) => void;
  setComparisonMonths: (months: number) => void;
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
  setEnabled: (id, enabled) => set((state) => {
    if (!state.decision?.tags.some((tag) => tag.id === id) || state.enabledTagIds.includes(id) === enabled) return state;
    return {
      enabledTagIds: enabled ? [...state.enabledTagIds, id] : state.enabledTagIds.filter((value) => value !== id),
      simulationVersion: state.simulationVersion + 1,
    };
  }),
  setImportance: (tagId, importance) => set((state) => {
    if (importance !== undefined && (!Number.isInteger(importance) || importance < 1 || importance > 5)) return state;
    const tag = state.decision?.tags.find((item) => item.id === tagId);
    if (!state.decision || !tag || tag.type !== "consideration" || tag.importance === importance) return state;
    const decision = structuredClone(state.decision);
    const nextTag = decision.tags.find((item) => item.id === tagId)!;
    if (nextTag.type !== "consideration") return state;
    if (importance === undefined) delete nextTag.importance;
    else nextTag.importance = importance;
    return { decision, simulationVersion: state.simulationVersion + 1 };
  }),
  setComparisonMonths: (months) => set((state) => {
    if (!state.decision || !isSubscriptionDecision(state.decision) || !Number.isInteger(months) || months < 1 || months > 120 || state.decision.comparisonMonths === months) return state;
    return { decision: { ...state.decision, comparisonMonths: months }, simulationVersion: state.simulationVersion + 1 };
  }),
  updateNumeric: (path, field) => set((state) => ({
    decision: state.decision ? assignAtPath(state.decision, path, field) : null,
    simulationVersion: state.simulationVersion + 1,
  })),
}));
