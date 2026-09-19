export type Source = 'user_input' | 'user_edit' | 'model_suggestion' | 'demo' | 'material' | 'unknown' | 'derived';
export type Value = { value: number | string | boolean | null; source: Source; note: string; materialId?: string; quote?: string };
export type Currency = 'USD' | 'CNY' | 'EUR' | 'GBP' | 'CAD';
export type Material = { id: string; title: string; text: string };
export type CostItem = { id: string; name: string; cadence: 'one_time' | 'monthly' | 'annual' | 'per_use'; amount: Value };
export type ChoiceOption = { id: string; name: string; description: string; costs: CostItem[]; costsComplete: boolean; minutesPerUse: Value; minutesPerMonth: Value; materials: Material[] };
export type RuleId = 'total_cost' | 'first_payment' | 'monthly_payment' | 'cost_per_use' | 'total_time' | 'monthly_time';
export type Factor = {
  id: string; name: string; reason: string; optionIds: string[];
  dataType: 'number' | 'money' | 'duration' | 'date' | 'boolean' | 'category' | 'text';
  unit: string; allowedValues: string[];
  direction: 'minimize' | 'maximize' | 'target' | 'none';
  purpose: 'hard' | 'preference' | 'reference'; importance: number;
  target: { min: number | string | null; max: number | string | null; desired: number | string | boolean | null };
  values: Record<string, Value>; userQuote?: string; origin: 'user' | 'model' | 'demo'; confirmed: boolean; ruleId?: RuleId;
};
export type ChoiceDecision = {
  schemaVersion: 2; id: string; version: number; title: string; description: string; originalInput: string;
  domain: string; decisionType: string; template: 'general' | 'subscription' | 'housing' | 'purchase'; currency: Currency;
  goals: { text: string; source: 'user_input' | 'model_suggestion'; quote: string }[];
  context: { months: Value; usesPerMonth: Value; budgetCents: Value };
  options: ChoiceOption[]; factors: Factor[]; primaryFactorId: string | null;
  questions: string[]; assumptions: string[]; mode: 'live' | 'demo' | 'manual';
};
export type FindingLabel = 'urgency' | 'scarcity' | 'social_pressure' | 'emotional_pressure' | 'unclear_price' | 'unclear_terms' | 'unsupported_claim' | 'normal_marketing' | 'disclosed' | 'conflict';
export type Finding = { id: string; optionId: string; materialIds: string[]; quotes: { materialId: string; quote: string }[]; labels: FindingLabel[]; explanation: string; needsVerification: boolean };
export type Extraction = { id: string; optionId: string; materialId: string; quote: string; label: string; value: number | string | boolean; unit: string; costId: string | null; factorId: string | null };
export type MaterialAnalysis = { decisionId: string; decisionVersion: number; optionId: string; status: 'no_materials' | 'no_pressure_found' | 'needs_verification' | 'inconsistent'; findings: Finding[]; extractions: Extraction[]; limitations: string[] };
export type OptionCalculation = {
  optionId: string; totalCostCents: number | null; firstPaymentCents: number | null; monthlyPaymentCents: number | null;
  costPerUseCents: number | null; totalMinutes: number | null; monthlyMinutes: number | null;
  cumulativeCosts: { month: number; costCents: number | null }[];
  factorValues: Record<string, Value>; eligibility: 'eligible' | 'pending' | 'ineligible'; failed: string[]; unknown: string[];
  summary: { start: string; routine: string; horizon: string; reconsider: string }; issues: string[];
};
export type ChoiceCalculation = {
  options: OptionCalculation[];
  comparison: { status: 'preferred' | 'tie' | 'insufficient' | 'no_feasible' | 'unranked'; preferredIds: string[]; message: string };
  breakEven: { month: number; kind: 'tie' | 'switch'; message: string }[]; issues: string[];
};
