# Dayfork — Project Memory

Last updated: 2026-09-19

## Status and Authorization

The user supplied an MVP specification and a technology proposal, requested a data and Tag contract, and then requested that the existing plan and agreements be recorded in project memory.

The user explicitly requested implementation of the local MVP plan. The application is implemented in `frontend/` and `backend/`. Offline acceptance passed: 19 frontend tests, 9 backend tests, a production frontend build, a bundled Spring Boot package, and localhost page/API checks. Browser interaction was manually checked on desktop and narrow layouts; there is no automated browser regression suite yet.

The canonical local repository is `/Users/ivan/Desktop/my-projects/SteelHacks`, linked to `https://github.com/2004Moonlove/SteelHacks`. The offline MVP was committed and pushed to `main` as `277e199` on 2026-09-19. During relocation, the prior project directory went to macOS Trash and the source was recovered into the current repository; the frontend lockfile was regenerated and the offline checks passed again. Codex's saved `SteelHacks-` project path is a local symlink to the canonical directory.

The product was renamed to Dayfork on 2026-09-19. The UI branding, frontend package, backend namespace (`app.dayfork`), application entry point, build artifact (`dayfork-0.1.0.jar`), and documentation now use the new name. Rename verification passed: 19 frontend tests, 9 backend tests, both production builds, and localhost checks for the packaged page, UI assets, and API health.

The user chose offline verification for this round. Real Nemotron scenario and story requests remain unverified: the local demo did not have `NVIDIA_API_KEY` and `NVIDIA_MODEL` configured, and its health response reported `modelConfigured: false`. A key previously disclosed in chat must be rotated before live use; never copy it into source, project memory, or Git history.

This file distinguishes explicit requirements from working design decisions and suggestions that remain unresolved.

## Confirmed User Preferences

- The product name is Dayfork, renamed from Parallel Me by user request on 2026-09-19. Use `Dayfork` in prose and `dayfork` in lowercase identifiers.
- Run and demonstrate the application locally first. Public hosting is not the current delivery target.
- Use English for every product screen and user-facing error.
- Use English for code naming and comments.
- Use English for README files and other project documentation, GitHub branch names, commit messages, issues, and PR titles and descriptions.
- Continue communicating with the user in Chinese.
- The user has requested implementation of the local MVP.
- For small, low-risk changes on the current branch, commit and push directly after appropriate local verification without asking for redundant confirmation. The user confirmed this workflow on 2026-09-19.
- Use a light, modern product UI with white and slate surfaces and blue and teal option accents.

## Product Goal

Dayfork turns a real-life decision between exactly two options into editable scenarios, calculates their monthly money and time tradeoffs, and presents two comparable narrative experiences.

The product does not recommend a winner, assign scores, or claim that a computed exchange rate represents the user's personal value of time.

Core flow:

1. Enter a decision in natural language.
2. An LLM returns exactly two options, baseline parameters, and 5–10 suggested Tags.
3. Review and edit the baseline, including missing values and clearly labeled assumptions.
4. Enable or disable Tags and edit their parameters.
5. Recalculate monthly cost and time immediately in the browser.
6. Explicitly request Parallel Stories for the current valid configuration.
7. Compare both options within the same scenario and corresponding moments.

The campus housing example is the primary test and demonstration fixture. The first release accepts general two-option decisions that can be represented using monthly cost, time, and the four defined Tag types.

## Technology Baseline

The supplied technology plan is the working implementation baseline:

| Area | Choice and responsibility |
| --- | --- |
| Frontend | React + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| State | Zustand |
| Charts | Recharts; separate cost and time bar charts |
| Simulation | Independent TypeScript pure functions |
| Frontend validation | Zod |
| Backend | Java 21 + Spring Boot + RestClient |
| Backend validation | DTO validation and domain validation |
| Model | NVIDIA-hosted Nemotron API |
| Optional persistence | Zustand persist + localStorage, browser-local only |
| Tests | Vitest for meaningful simulation and validation coverage |

Implemented dependency versions are recorded by `frontend/package-lock.json` and `backend/pom.xml` (Spring Boot 3.5.7). The available Nemotron model ID remains unselected. Verify account access and endpoint behavior before claiming live-model acceptance.

The backend protects credentials, calls the model, validates its output, and exposes decision generation at `POST /api/scenarios/generate` and story generation at `POST /api/stories/generate`.

The supplied NVIDIA endpoint is `https://integrate.api.nvidia.com/v1/chat/completions`; verify support for the selected model and structured-output capabilities before integration. Keep credentials in backend environment variables. Never expose a secret through a `VITE_*` variable, browser code, committed configuration, or project memory.

Development can run the frontend and backend separately. The `bundle-frontend` Maven profile packages the built frontend into Spring Boot; the packaged app has been verified on localhost.

## Architecture Invariants

- Exactly two categories of model calls: build a decision and explicitly generate/update stories.
- Tag toggles, sliders, prices, frequencies, and time edits never call the model or backend for calculation.
- Recompute from the entire current baseline and enabled Tag configuration on every change. Never mutate the previous result by accumulating deltas.
- The LLM may choose predefined Tag types and supply data. It may not invent executable formulas, JavaScript, or components.
- Calculations must keep working for an already loaded valid scenario when the model service is unavailable.
- Model output must pass structural and semantic validation before use. One bounded repair attempt is implemented; otherwise preserve the user's input and show a retryable error.
- Provide an explicitly labeled demo fixture. Never present a fallback fixture as a newly generated model response.
- Do not add databases, authentication, banking or calendar integration, maps, automatic rent lookup, Redis, Kafka, Elasticsearch, RAG, vector databases, WebSockets, multi-agent product architecture, Monte Carlo simulation, or subjective happiness/stress/regret scores to the MVP.

## Working Data Contract v1

This contract was developed in planning and implemented in `frontend/src/domain/`. The backend independently reconciles story request totals, breakdowns, and facts before model generation.

### Canonical Units and Numeric Fields

- Currency: USD for v1.
- Money: integer cents.
- Time: integer minutes.
- Frequency: integer activity events per month.
- Values must be finite, nonnegative safe integers. Conversion factors must be positive safe integers. Validate arithmetic results for safe integer overflow as well.
- Unknown values are `null`, never zero.

```ts
type NumericField =
  | {
      value: number;
      source: "user_input" | "user_edit" | "derived";
      note?: string;
    }
  | {
      value: number;
      source: "demo_assumption";
      confirmed: boolean;
      note: string;
    }
  | {
      value: null;
      source: "unknown";
      note?: string;
    };
```

- `user_input`: explicitly provided in the user's original text.
- `user_edit`: entered or changed through the UI.
- `derived`: a deterministic conversion of known input, such as 20 campus days to 40 one-way trips. Do not use this label for guessed data.
- `demo_assumption`: an explicitly labeled example value that requires confirmation before calculation.
- `unknown`: missing information.

When the model does not know a number, it returns an unknown field. Populate demo assumptions only after the user chooses that route. Notes explain data; they are not executable formulas. Editing a numeric field changes its source to `user_edit`.

### Decision, Options, Fixed Costs, and Activities

```ts
type Decision = {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  originalInput: string;
  currency: "USD";
  options: [Option, Option];
  tags: Tag[];
};

type Option = {
  id: string;
  name: string;
  fixedCosts: FixedCost[];
  activities: Activity[];
};

type FixedCost = {
  id: string;
  name: string;
  amountCentsMonthly: NumericField;
};

type Activity = {
  id: string;
  name: string;
  eventUnit: "one_way_trip" | "meal" | "session" | "event";
  frequencyInput?: {
    label: string;
    eventsPerUnit: number;
  };
  eventsPerMonth: NumericField;
  costCentsPerEvent: NumericField;
  minutesPerEvent: NumericField;
};
```

Fixed cost line items replace a single opaque base-cost total so the breakdown can explain rent and other charges.

An activity's frequency is stored once. For example, the UI may display 20 campus days using `eventsPerUnit: 2`, but the canonical field contains 40 one-way events. A change to 18 days writes 36 events. Do not persist a second independently editable day count. Preserve exact event counts if a UI conversion produces a fractional displayed unit; never silently round.

Each option owns its parameters. A shared editor must explicitly indicate that it updates both options. IDs must remain stable and unique within their owning collections; references are resolved using `optionId` and, where applicable, `activityId`.

## Tag Contract

Keep four explicit external types: `fixed`, `add_activity`, `reduce_activity`, and `replace_activity`. The technology proposal's three conceptual rule groups do not replace this four-type data contract.

```ts
type TagBase = {
  id: string;
  name: string;
  icon?: string;
  description: string;
};

type FixedTag = TagBase & {
  type: "fixed";
  targets: Array<{
    optionId: string;
    costCentsMonthly: NumericField;
    minutesMonthly: NumericField;
  }>;
};

type AddActivityTag = TagBase & {
  type: "add_activity";
  targets: Array<{
    optionId: string;
    activityId: string;
    eventsPerMonth: NumericField;
  }>;
};

type ReduceActivityTag = TagBase & {
  type: "reduce_activity";
  targets: Array<{
    optionId: string;
    activityId: string;
    eventsPerMonth: NumericField;
  }>;
};

type ReplaceActivityTag = TagBase & {
  type: "replace_activity";
  targets: Array<{
    optionId: string;
    activityId: string;
    replacementName: string;
    eventsPerMonth: NumericField;
    costCentsPerEvent: NumericField;
    minutesPerEvent: NumericField;
  }>;
};

type Tag = FixedTag | AddActivityTag | ReduceActivityTag | ReplaceActivityTag;
```

`targets` associates each option with its own parameters, supporting different prices and times across options without parallel reference and parameter arrays. Target arrays must be nonempty, and a Tag may not repeat the same target.

### Fixed

Adds fixed monthly money and/or time. A transit pass can add 9750 cents and 0 minutes. Reducing transit trips does not refund part of a fixed pass.

### Add Activity

Adds events to an existing baseline activity and inherits that option's original per-event cost and time. Five extra round trips become ten one-way events.

This type does not create a new activity in v1. A grocery-trip Tag must reference an already modeled baseline activity, which may start at a confirmed frequency of zero.

### Reduce Activity

Subtracts events from an existing baseline activity. The parameter is nonnegative; the type determines subtraction. Four fewer campus days become eight fewer one-way events.

### Replace Activity

Replaces some available original events with a named alternative having its own per-event cost and time. One replacement consumes one original event and inherits its event unit. If commute events are one-way trips, replacement parameters must also describe one-way trips.

No Tag-to-Tag references, nested replacement, or replacement of an already replaced event in v1.

The model distributes monthly event counts, not individually identified calendar events. Uber and driving Tags can both be enabled when their combined counts fit the available activity count; they are not automatically mutually exclusive.

## State and Editing

```ts
type SimulationState = {
  decision: Decision;
  enabledTagIds: string[];
  simulationVersion: number;
};
```

- Start with `enabledTagIds: []`.
- Do not also store `enabled` inside Tags or maintain another mutable `tagValues` copy.
- Update the corresponding numeric field in the decision when the user commits an edit.
- Retain edited parameters when a Tag is disabled and reenabled.
- Keep temporary input strings in component editing state, outside the canonical calculation model.
- Derive totals and breakdowns rather than storing them as independently mutable state.
- Increment the simulation version for committed baseline changes, Tag parameter changes, and enable/disable changes.
- A generated story keeps the configuration and result snapshot used for its request. Do not relabel an in-flight response as belonging to a newer configuration.

## Calculation Order and Validation

For each activity in each option:

```text
available = baseline events + sum(enabled add events) - sum(enabled reduce events)
replacementCount = sum(enabled replacement events)
originalCount = available - replacementCount

activityCost = originalCount * originalCostPerEvent
             + sum(each replacement count * its costPerEvent)

activityTime = originalCount * originalMinutesPerEvent
             + sum(each replacement count * its minutesPerEvent)
```

Then add baseline fixed cost items and enabled fixed Tag amounts. Aggregate additions and reductions before applying replacements. Results must not depend on Tag ordering.

Validation behavior:

- Negative available counts are invalid; never silently clamp to zero.
- Replacement counts exceeding available counts are invalid; never silently truncate or prioritize one Tag by array order.
- Missing or unconfirmed baseline parameters block calculation.
- Missing or unconfirmed parameters in enabled Tags block calculation.
- Incomplete disabled Tags do not block calculation; malformed structures and invalid references still fail structural validation.
- Reject nonexistent option/activity references, duplicate IDs or targets, and invalid numeric values.
- Preserve an invalid user configuration for correction, mark current results as unavailable, and disable story generation. Never display previous valid totals as if they belonged to the invalid configuration.

## Calculation Output

```ts
type CalculationResult =
  | {
      status: "valid";
      options: [OptionResult, OptionResult];
      comparison: {
        // Option B minus Option A, consistently.
        costDeltaCents: number;
        timeDeltaMinutes: number;
      };
    }
  | {
      status: "invalid";
      issues: ValidationIssue[];
    };

type OptionResult = {
  optionId: string;
  totalCostCents: number;
  totalTimeMinutes: number;
  breakdown: BreakdownItem[];
};

type BreakdownItem = {
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

type ValidationIssue = {
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
```

Totals and line items come from the same calculation pass. Comparison deltas may be negative even though input costs and durations may not. Structural schema errors may be reported separately from this calculation error union.

## Dashboard and Stories

The core dashboard shows monthly cost, monthly time, an option difference card, separate bar charts, and an expandable calculation breakdown.

The difference card must handle every sign combination: money/time tradeoffs, one option using less of both, one using more of both, ties, and zero time differences. The optional savings-per-additional-hour metric must not divide by zero or be mislabeled as the value of the user's time. Do not call all tracked time "commute time" when other activities contribute.

Stories:

- Generate only after an explicit user action and only for a valid simulation.
- Use the same shared circumstances and corresponding moments for both options; suggested sections are Morning, Daytime, Evening, and Monthly Reflection.
- Do not introduce unconfigured paid or time-consuming events, unequal weather, extra traffic, extra rides, or meals.
- Do not invent happiness, exhaustion, mental-health outcomes, grades, regret, or other unmodeled consequences.
- Use engine-calculated totals and differences. Prefer frontend insertion of important numeric values.
- Return structured shared-scenario and per-moment content, not one unstructured text blob.
- Keep a generation version and snapshot. A stale story must not appear to describe updated inputs; regeneration remains explicit.

Confirmed story presentation: Campus day uses shared arrival/departure anchors and program-calculated travel time points; general decisions use aligned Morning, Daytime, Evening, and Monthly Reflection text without invented clock times. Label campus timelines as illustrative days while monthly totals reflect the entire monthly configuration. Six monthly Uber trips must not imply daily Uber use. The implemented story API is summarized in the README and validated by the backend.

## Priorities

Original P0:

- Natural-language decision input.
- Two generated options, editable baseline, and 5–10 generated Tags.
- Tag enable/disable and parameter editing.
- Independent simulation engine with validation.
- Real-time monthly money/time dashboard, differences, and breakdown.
- Explicit Parallel Story generation, matched circumstances, and consistency with the simulation.

Original P1:

- Latest-change display and animation.
- Custom Tags.
- Story stale detection.
- Savings per additional hour.
- Browser-local persistence.

Minimal stale-story indication is included in P0. Persistence remains P1; selecting localStorage as the future approach does not make persistence a required first milestone.

## Implementation Sequence (P0)

1. Establish the v1 schema, validators, and fixed housing fixture.
2. Build the pure simulation engine and meaningful tests for all four Tag types and interactions.
3. Build baseline review, Tag editing, dashboard comparisons, and breakdown using the fixture.
4. Integrate backend model generation against the same contract.
5. Build explicit story generation and consistent presentation.
6. Add P1 work as time permits and verify the local demonstration path.

Validation belongs with the schema and engine, not at the end of development. Do not prioritize polished AI/UI integration before the add/reduce/replace mathematics is correct.

## Acceptance Fixture

Baseline:

- Near: rent 150000 cents/month; 40 one-way commute events/month; 0 cents/event; 10 minutes/event.
- Far: rent 110000 cents/month; 40 one-way commute events/month; 0 cents/event; 40 minutes/event.
- These commute costs are known fixture values, not defaults for unknown real-world costs.
- Uber replacement applies only to Far, at 2500 cents and 20 minutes per one-way event.

Each row below is an independent configuration relative to the baseline:

| Configuration | Near monthly cost / time | Far monthly cost / time |
| --- | --- | --- |
| No Tags | $1500 / 400 min | $1100 / 1600 min |
| Uber 6 events | $1500 / 400 min | $1250 / 1480 min |
| Uber 10 events | $1500 / 400 min | $1350 / 1400 min |
| Reduce commute by 8 events in both options; Uber 6 in Far | $1500 / 320 min | $1250 / 1160 min |
| Add 10 commute events in both options; Uber 6 in Far | $1500 / 500 min | $1250 / 1880 min |
| Far has 32 available events; Uber 20 plus Drive 15 | Entire comparison invalid | No current totals |

For Uber 6, Far saves $250 and uses 1080 additional minutes (18 hours). For Uber 10, Far saves $150 and uses 1000 additional minutes (16 hours 40 minutes). Changing Uber from 6 to 10 adds $100 and removes 80 minutes from Far.

Also test: disabling all Tags restores baseline; zero frequencies have no effect; replacements deduct original costs and time; fixed passes are not refunded; Tag order does not change results; missing data is not coerced to zero; invalid reductions and replacement overflow are visible errors; totals reconcile with breakdown lines.

## Still Unresolved

- Deadline and available implementation/demo time.
- An accessible Nemotron model ID and live API behavior for scenario and story generation. Do not ask the user to paste credentials into chat.
- The quality of real story narratives against the rule forbidding unconfigured events, subjective outcomes, and winner recommendations.

Offline verification is complete. Live model acceptance remains pending until a fresh local credential and model ID are configured and real requests succeed.

## Recommended Next Steps (Suggestions, Not Confirmed Scope)

1. Rotate the previously disclosed API key, select an accessible Nemotron model ID, configure both values only in the local backend environment, and verify that the health endpoint reports model configuration.
2. Complete live acceptance with a campus housing decision, a non-housing decision, and an input missing key numbers. Generate both General day and Campus day stories, and inspect facts, repair behavior, and retryable errors.
3. Add browser-level regression coverage for baseline confirmation, invalid edits, desktop/narrow layouts, stale stories, request races, and the invariant that Tag changes do not call the model. Existing frontend tests cover pure functions; backend tests use a fake model client.
4. Review real story samples for unsupported nonnumeric events and subjective claims, which structural validators cannot fully rule out. Adjust prompts or validation only in response to observed failures.
5. After live acceptance, consider P1 browser-local persistence and restore validation first, then custom Tags, Latest Change animation, and the optional per-hour comparison metric.
