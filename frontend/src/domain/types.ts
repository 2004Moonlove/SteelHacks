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
  usageCosts?: { upfrontCents: NumericField; perUseCents: NumericField };
  subscriptionCosts?: { paymentCents: NumericField; periodMonths: number };
};

export type TagBase = { id: string; name: string; icon?: string; description: string; group?: string };
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
export type ConsiderationTag = TagBase & {
  type: "consideration";
  importance?: number;
  targets: { optionId: string; consideration: string }[];
};
export type Tag = FixedTag | AddActivityTag | ReduceActivityTag | ReplaceActivityTag | ConsiderationTag;

export type Decision = {
  schemaVersion: 1 | 2;
  comparisonMode?: "quantitative" | "qualitative" | "break_even" | "subscription";
  usageUnit?: string;
  comparisonMonths?: number;
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

export type UsageOptionResult = { optionId: string; upfrontCents: number; perUseCents: number };
export type BreakEvenResult = {
  status: "break_even";
  options: [UsageOptionResult, UsageOptionResult];
  crossover:
    | { kind: "crossing"; numerator: number; denominator: number; firstWholeUse: number; recoveryOptionId: string }
    | { kind: "equal" }
    | { kind: "no_crossing" };
};

export type SubscriptionResult = {
  status: "subscription";
  comparisonMonths: number;
  options: [{ optionId: string; totalCostCents: number; paymentCount: number; coverageMonths: number }, { optionId: string; totalCostCents: number; paymentCount: number; coverageMonths: number }];
  timeline: { month: number; optionACostCents: number; optionBCostCents: number }[];
  comparison: { costDeltaCents: number };
};

export type CalculationResult =
  | SubscriptionResult
  | BreakEvenResult
  | ValidCalculationResult
  | { status: "qualitative" }
  | { status: "invalid"; issues: ValidationIssue[] };
