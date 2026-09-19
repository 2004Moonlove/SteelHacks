export type NumericField =
  | { value: number; source: "user_input" | "user_edit" | "derived"; note?: string }
  | { value: number; source: "demo_assumption"; confirmed: boolean; note: string }
  | { value: null; source: "unknown"; note?: string };

export type FixedCost = {
  id: string;
  name: string;
  amountCentsMonthly: NumericField;
};

export type Activity = {
  id: string;
  name: string;
  eventUnit: "one_way_trip" | "meal" | "session" | "event";
  frequencyInput?: { label: string; eventsPerUnit: number };
  eventsPerMonth: NumericField;
  costCentsPerEvent: NumericField;
  minutesPerEvent: NumericField;
};

export type Option = {
  id: string;
  name: string;
  fixedCosts: FixedCost[];
  activities: Activity[];
};

export type TagBase = { id: string; name: string; icon?: string; description: string };
export type FixedTag = TagBase & {
  type: "fixed";
  targets: { optionId: string; costCentsMonthly: NumericField; minutesMonthly: NumericField }[];
};
export type AddActivityTag = TagBase & {
  type: "add_activity";
  targets: { optionId: string; activityId: string; eventsPerMonth: NumericField }[];
};
export type ReduceActivityTag = TagBase & {
  type: "reduce_activity";
  targets: { optionId: string; activityId: string; eventsPerMonth: NumericField }[];
};
export type ReplaceActivityTag = TagBase & {
  type: "replace_activity";
  targets: {
    optionId: string;
    activityId: string;
    replacementName: string;
    eventsPerMonth: NumericField;
    costCentsPerEvent: NumericField;
    minutesPerEvent: NumericField;
  }[];
};
export type Tag = FixedTag | AddActivityTag | ReduceActivityTag | ReplaceActivityTag;

export type Decision = {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  originalInput: string;
  currency: "USD";
  options: [Option, Option];
  tags: Tag[];
};

export type SimulationState = {
  decision: Decision;
  enabledTagIds: string[];
  simulationVersion: number;
};

export type ValidationIssue = {
  code:
    | "MISSING_VALUE"
    | "UNCONFIRMED_ASSUMPTION"
    | "INVALID_NUMBER"
    | "INVALID_REFERENCE"
    | "NEGATIVE_ACTIVITY_COUNT"
    | "REPLACEMENT_OVERFLOW";
  path: string;
  message: string;
  optionId?: string;
  activityId?: string;
  tagIds?: string[];
};

export type BreakdownItem = {
  id: string;
  kind: "baseline_fixed" | "original_activity" | "replacement_activity" | "tag_fixed";
  label: string;
  activityId?: string;
  tagId?: string;
  eventsPerMonth?: number;
  costCentsPerEvent?: number;
  minutesPerEvent?: number;
  totalCostCents: number;
  totalTimeMinutes: number;
};

export type OptionResult = {
  optionId: string;
  totalCostCents: number;
  totalTimeMinutes: number;
  breakdown: BreakdownItem[];
};

export type ValidCalculationResult = {
  status: "valid";
  options: [OptionResult, OptionResult];
  comparison: { costDeltaCents: number; timeDeltaMinutes: number };
};

export type CalculationResult =
  | ValidCalculationResult
  | { status: "invalid"; issues: ValidationIssue[] };
