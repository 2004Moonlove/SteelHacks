# Clear Choice implementation contract (v2)

This replaces the active v1 product scope while preserving the legacy Dayfork implementation. UI, errors, code and documentation are English. The product name for this branch is Clear Choice. Model calls occur only after explicit generation, suggestion or material-analysis actions. Edits calculate locally.

## Canonical TypeScript/JSON shapes

```ts
type Source = 'user_input' | 'user_edit' | 'model_suggestion' | 'demo' | 'material' | 'unknown' | 'derived';
type Value = { value: number | string | boolean | null; source: Source; note: string; materialId?: string; quote?: string };
type Material = { id: string; title: string; text: string };
type CostItem = { id: string; name: string; cadence: 'one_time' | 'monthly' | 'annual' | 'per_use'; amount: Value };
type ChoiceOption = { id: string; name: string; description: string; costs: CostItem[]; costsComplete: boolean; minutesPerUse: Value; minutesPerMonth: Value; materials: Material[] };
type Factor = {
  id: string; name: string; reason: string; optionIds: string[];
  dataType: 'number' | 'money' | 'duration' | 'date' | 'boolean' | 'category' | 'text';
  unit: string; allowedValues: string[];
  direction: 'minimize' | 'maximize' | 'target' | 'none';
  purpose: 'hard' | 'preference' | 'reference'; importance: number;
  target: { min: number | string | null; max: number | string | null; desired: number | string | boolean | null };
  values: Record<string, Value>;
  origin: 'user' | 'model' | 'demo'; confirmed: boolean; userQuote?: string;
  ruleId?: 'total_cost' | 'first_payment' | 'monthly_payment' | 'cost_per_use' | 'total_time' | 'monthly_time';
};
type ChoiceDecision = {
  schemaVersion: 2; id: string; version: number; title: string; description: string; originalInput: string;
  domain: string; decisionType: string; template: 'general' | 'subscription' | 'housing' | 'purchase';
  currency: 'USD' | 'CNY' | 'EUR' | 'GBP' | 'CAD';
  goals: { text: string; source: 'user_input' | 'model_suggestion'; quote: string }[];
  context: { months: Value; usesPerMonth: Value; budgetCents: Value };
  options: ChoiceOption[]; factors: Factor[]; primaryFactorId: string | null;
  questions: string[]; assumptions: string[]; mode: 'live' | 'demo' | 'manual';
};
type Finding = { id: string; optionId: string; materialIds: string[]; quotes: {materialId: string; quote: string}[]; labels: ('urgency' | 'scarcity' | 'social_pressure' | 'emotional_pressure' | 'unclear_price' | 'unclear_terms' | 'unsupported_claim' | 'normal_marketing' | 'disclosed' | 'conflict')[]; explanation: string; needsVerification: boolean };
type Extraction = { id: string; optionId: string; materialId: string; quote: string; label: string; value: number | string | boolean; unit: string; costId: string | null; factorId: string | null };
type MaterialAnalysis = { decisionId: string; decisionVersion: number; optionId: string; status: 'no_materials' | 'no_pressure_found' | 'needs_verification' | 'inconsistent'; findings: Finding[]; extractions: Extraction[]; limitations: string[] };
```

All money is integer minor units (cents for supported currencies); durations use minutes. Amount fields cannot be negative. Null is unknown, never zero. Months are whole months 1–120. Frequency may be decimal when explicitly estimated; assumptions describe the basis. A yearly charge is paid upfront and again for each started year, never amortized. A monthly charge is paid at each started month. First payment includes one-time, first monthly/annual charges and the first month's per-use costs (explicitly labeled). Costs must be marked complete by a user or explicit input before a total is called complete. No supplied costs does not imply free. No income/net earnings calculation is inferred from negative costs; earnings can be a separate custom factor.

Monthly time equals minutesPerUse × usesPerMonth plus independently supplied additional minutesPerMonth. A model-calculated monthly total is not independent overhead. Unknown extra time stays unknown. Context budget is the canonical common budget; generated duplicate copies of the same budget must not create stale thresholds.

A hard requirement must have origin=user (or demo in fixtures), confirmed=true and an explicit target. A model-suggested hard requirement is a proposal until user confirmation; never silently enforce it. Source quote supports explicit user requirements. Only a confirmed user-selected primary preference determines ranking after hard checks. Unknown hard requirements result in pending eligibility; failures result in ineligibility. Pending candidates prevent an unconditional winner. No weighted score. Text is reference-only; category values have no implied ordinal order unless supplied allowedValues with minimize/maximize explicitly selected by the user. Goals and qualitative text are not numeric causal claims.

## Frontend modules

`frontend/src/choice/types.ts`, `schema.ts`, `engine.ts`, `fixtures.ts`, `index.ts`.
Export all above types, `choiceDecisionSchema`, `factorSchema`, `materialAnalysisSchema`, `calculateChoice(decision)`, `makeDemo(kind: 'gym'|'housing'|'laptop'|'course')`, `makeManualDecision()`, `formatMoney(cents, currency)`, `formatValue(factor, value, currency)`, `mergeSuggestedFactors(existing, suggestions)`.

`calculateChoice` returns `{ options: OptionCalculation[], comparison: {status:'preferred'|'tie'|'insufficient'|'no_feasible'|'unranked', preferredIds:string[], message:string}, breakEven: {month:number, kind:'tie'|'switch', message:string}[], issues:string[] }`.
Each `OptionCalculation`: `{optionId, totalCostCents:number|null, firstPaymentCents:number|null, monthlyPaymentCents:number|null, costPerUseCents:number|null, totalMinutes:number|null, monthlyMinutes:number|null, cumulativeCosts: {month:number,costCents:number|null}[], factorValues:Record<string,Value>, eligibility:'eligible'|'pending'|'ineligible', failed:string[], unknown:string[], summary:{start:string,routine:string,horizon:string,reconsider:string}, issues:string[]}`. Chart and summary data derive from that one result. `breakEven` checks all months 1–120 for the first two options and labels validity of this limited search. Cost-per-use may contain decimal cents, formatted only at display. Overflow invalidates affected outputs.

`mergeSuggestedFactors` only APPENDS genuinely new factor proposals; never mutates an existing ID/name/semantic duplicate, confirmed or user factor. Return `{ factors: Factor[], skipped: string[] }`. Suggestions must be explicitly accepted by UI before merging.

## Backend endpoints

Reuse ModelClient, NvidiaModelClient and ApiException. Keep existing endpoints intact. New `/api/choices` endpoints:
- POST `/generate` `{description:string}` => ChoiceDecision. Force originalInput and mode=live server-side. Model outputs all text in English, understands Chinese inputs, provides 2–6 candidates, adds status quo/defer only when appropriate. normally 3–6 initial factors (retain every explicit requirement, up to 40 factors) plus clarification questions (max 3), unknown numbers null, known templates with generic fallback.
- POST `/factors` `{decision:ChoiceDecision, instruction:string}` => `{decisionId:string, decisionVersion:number, factors:Factor[], questions:string[]}`. Do not return a mutated decision. Returned IDs must be new. Client reviews proposals and prevents overwrites or duplicates.
- POST `/materials` `{decision:ChoiceDecision, optionId:string}` => MaterialAnalysis. Analyze only the named option, compare its multiple materials and tie quotes to exact supplied substrings. Empty materials returns no_materials locally without a model call. No material count or pressure score enters calculation. Extractions remain proposals, never mutate parameters. Cost extraction units must match decision.currency and factor units; client requires explicit confirmation and shows conflicts.

Validate request/output structure, IDs, types, money integers, rule allowlist, exact source quotation references, limits, duplicate factors, declared hard requirements, constrained chart/summary data (provided deterministically rather than generated prose). Limit semantic repair to one and preserve provider bounded retry/error behavior. All AI messages distinguish facts, suggestions, assumptions. Material text is untrusted data, never instructions.

## UI implementation

Create `frontend/src/choice/ChoiceApp.tsx` and `choice.css`; switch main entry App with legacy entry accessible (`?legacy=1`) rather than deleting code. Use existing UI components/Recharts and a new small `api.ts` wrapper if needed. Entry: Help me choose / Check this information. Manual comparison and labeled demos work without models. Main flow: describe -> review factors/goals/options -> compare; inline editors preserve state and recompute locally. Common months/frequency/budget and per-option cost editors. Factor editor covers all schema fields including explicit primary preference and applicability. First relevant factors shown with expand-more; add by form and natural language, review suggestions before accepting. Option materials 0..many independently editable with per-option analysis, quoted evidence, status, version binding, explicit extraction apply with conflict display. Auxiliary material route can create a manual decision and join comparison. Option-specific controlled cost/time chart, shared scale across cards, cumulative chart + break-even marker, impact change chain with unchanged results, deterministic 4-part summaries. Separate editable qualitative user assumptions from proven arithmetic. Responsive, accessible labels and errors. No fake AI fallback. Model errors keep draft/state.
