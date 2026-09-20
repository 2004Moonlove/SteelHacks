# Dayfork — Project Memory

Last updated: 2026-09-20. Keep this file within 300 lines; link detailed evidence instead of accumulating implementation history.

## Current Status and Authorization

- The user explicitly authorized local MVP implementation through local verification; do not ask for redundant permission.
- Dayfork is implemented in `frontend/` and `backend/`. The original offline MVP and rename passed tests, production builds, and localhost checks.
- Canonical repository: `/Users/ivan/Desktop/my-projects/SteelHacks`; saved project path `SteelHacks-` is a symlink to it. Remote: `https://github.com/2004Moonlove/SteelHacks`.
- Current inspected HEAD: `20537d7` (scenario contracts and code-owned story metadata). Earlier milestones include `277e199` (MVP), `0ae8f8e` (Dayfork rename), and `437f752` (story-fact alignment).
- Qualitative decisions, per-use costs, importance controls, subscriptions, richer housing factors, and story presentation changes are present in the working tree; do not assume these uncommitted changes are on the remote.
- Qualitative and per-use flows have documented offline, browser, and actual-model acceptance. Subscription/story enhancements are newer; distinguish their latest test evidence from earlier complete acceptance.
- Implementation is changing concurrently. Validation below is a dated observation, not a guarantee that later edits or the running service match it.
- This file separates confirmed requirements, the working implementation contract, verified evidence, and unresolved suggestions.

## Confirmed User Preferences

- Product name: Dayfork (formerly Parallel Me). Use `Dayfork` in prose and `dayfork` in lowercase identifiers; backend namespace is `app.dayfork`.
- Communicate with the user in Chinese. Use English for UI, errors, code, comments, documentation, branches, commits, issues, and PRs.
- Prioritize local development and demonstration; public hosting is not the current delivery target.
- Small, low-risk changes on the current branch may be committed and pushed after appropriate local verification without redundant confirmation (authorized 2026-09-19).
- Keep the UI light and clear, with white/slate surfaces and blue/teal option accents. Avoid a tedious, form-heavy experience.
- Integrate corresponding stories with comparison results. Preserve explicit assumption review and explicit story-generation actions.
- Differentiation from Wage101 Commute vs Rent and the SASEHacks ParallelMe project is a product objective, not a verified claim about competitors' limitations.

## Confirmed Product Scope

- Compare exactly two paths for a medium- or long-term decision across all domains, including decisions whose effects cannot be quantified.
- Quantification is optional; one-off choices without continuing effects are not the target. The earlier recurring-spending-only proposal is superseded.
- Core flow: natural-language input → relevant selectable factors and applicable parameter review → deterministic comparisons where meaningful → paired stories.
- Qualitative decisions skip numerical baseline review, cost/time option cards, charts, and monthly reflections; retain both option identities and story labels.
- Quantitative decisions can mix numerical adjustments with qualitative factors. Missing numbers in a calculable scenario require review, not automatic qualitative routing.
- Coffee machine versus Starbucks must support upfront/per-use break-even even when prices are missing.
- Annual/monthly memberships must offer fee inputs and whole-period payment comparisons. The phrase `year card or month card` must not automatically imply a gym.
- QQQ ETF versus Certificate of Deposit must complete a qualitative scenario/story flow without treating principal as consumption or inventing returns.
- Numerical investment modeling, if added, must use user-confirmed hypothetical scenarios, not live market data or automatic investment recommendations.
- Give practical, option-specific suggestions without declaring a winner, computing subjective outcome scores, or calling an exchange rate the user's personal value of time.

## Confirmed Factor and Story Experience

- Factor counts follow relevant scenario coverage, with no global minimum or complexity quotas. Zero factors are valid; the technical maximum is 30.
- Typical broad on-campus versus off-campus housing should offer roughly 8–10 distinct factors, mixing numerical adjustments and qualitative concerns.
- That housing expectation is domain-specific; explicitly narrowed questions take precedence. More complex decisions may need more factors.
- Show up to ten factors before expansion. Hide the factor section when none exist.
- Qualitative factors may have optional user-set importance from 1 to 5: Not very important, Slightly important, Important, Very important, Essential.
- Unset importance means unknown; the model must not invent it. Users can clear it; disabling a factor preserves its setting.
- Importance changes narrative emphasis only, never arithmetic, probability, ranking, financial weight, or a computed preference score.
- Stories must depict concrete, clearly hypothetical experiences after choosing each path, not just lists of questions or repeated instructions to inspect priorities.
- Selected qualitative factors may support plausible situational detail beyond numerical rows. Such detail must not become an invented measurement or calculation input.
- Do not fabricate prices, exact time costs, specifications, guaranteed outcomes, or personal psychological conclusions.
- Provide practical suggestions for both paths and a visual journey through corresponding stages. Use descriptive stages for qualitative effects, not invented scores or trajectories.

## Architecture Invariants

- Only two categories of model calls: generate a decision; explicitly generate/update stories.
- Factor toggles, importance, prices, frequencies, time inputs, chart ranges, and comparison-window edits remain local and make no model calls.
- Recompute from the entire current baseline and enabled factor configuration; never accumulate deltas into a previous result.
- Money/time calculations are deterministic pure functions and continue working for a loaded valid decision without model availability.
- The model chooses predefined structures and supplies content; it cannot invent executable formulas, JavaScript, or components.
- Validate model structure and semantics before use. Allow one bounded semantic repair; otherwise preserve the input and show an actionable error.
- Label demo fixtures and offline story previews explicitly; never substitute them as if they were fresh model output.
- Do not add databases, authentication, banking/calendar integrations, maps, automatic rent lookup, Redis, Kafka, Elasticsearch, RAG, vector databases, WebSockets, multi-agent product architecture, Monte Carlo simulation, or subjective happiness/stress/regret scores to the MVP.

## Working Data Contract

- Canonical definitions: `frontend/src/domain/types.ts` and `schema.ts`; backend validation is independent in `ContractValidator.java`.
- New generations require `schemaVersion: 2` and explicit `comparisonMode: quantitative | qualitative | break_even | subscription`.
- Legacy v1 decisions retain monthly semantics, without new modes or consideration Tags; valid legacy story responses remain readable.
- Every decision retains ID, title, description, original input, `currency: "USD"`, exactly two options, and Tags.
- Option parameters belong to each option. IDs and references must be valid and unique within their collections; reject unexpected fields and duplicate targets.
- Qualitative, break-even, and subscription options have empty monthly `fixedCosts`/`activities`; their Tags are considerations only.
- Quantitative v2 supports the original numerical Tags plus considerations. Mode-specific fields are rejected in other modes.
- Calculation results discriminate `valid` (monthly), `qualitative`, `break_even`, `subscription`, or `invalid`; qualitative results have no synthetic zero totals.
- Structural limits and generation schema are enforced by code; this summary does not replace the validators.

### Units and Numeric Provenance

- Money uses integer cents; time uses integer minutes; monthly frequency uses integer events. Inputs are finite, nonnegative safe integers.
- Conversion factors are positive safe integers. Validate intermediate and final arithmetic for overflow; format money without floating-point cent loss.
- Unknown is `{ value: null, source: "unknown" }`, never an inferred zero.
- Known fields have `value`, `source: user_input | user_edit | derived`, and optional `note`.
- `user_input` means explicitly supplied; `user_edit` means committed through UI; `derived` means deterministic conversion of known input, never a guess.
- `demo_assumption` requires a numeric value, explanatory note, and explicit confirmation before ordinary calculation; labeled chosen demos may provide confirmed examples.
- Generation permits only `user_input`, `derived`, and `unknown`; it cannot assign user importance or silently populate demo assumptions.
- Notes explain data, not formulas. Editing a number sets its source to `user_edit`.
- Fixed costs are named line items with `amountCentsMonthly`. Activities store events/month, cents/event, and minutes/event.
- Activity units: `one_way_trip | meal | session | event`. Optional `frequencyInput: { label, eventsPerUnit }` controls display conversion only.
- Store frequency once: 20 campus days at two one-way events/day means 40 canonical events. Preserve exact event counts; never silently round or maintain a second mutable day count.

### Tag Semantics

| Type | Effect |
| --- | --- |
| `fixed` | Add option-specific monthly cost and/or time. A fixed pass is not refunded when trips decrease. |
| `add_activity` | Add events to an existing activity, inheriting its original per-event cost/time. |
| `reduce_activity` | Subtract a nonnegative event count from an existing activity. |
| `replace_activity` | Consume original events and replace them with a named alternative's own per-event cost/time, preserving the event unit. |
| `consideration` | Supply option-specific conditional concerns and optional importance; no numerical effect. |

- Tags have stable ID, name, description, optional icon/group, and nonempty targets. Considerations target one or both options via `{ optionId, consideration }`.
- Numerical activity targets reference `optionId` and `activityId`; add/reduce Tags do not create new activities. A referenced baseline activity may have a confirmed zero frequency.
- No Tag-to-Tag references, nested replacements, or replacement of an already replaced event.
- Different replacement Tags can coexist when their summed event counts fit availability; there are no individually assigned calendar events.
- Newly generated consideration text must be a question ending in `?` or an explicit condition starting with `If`. This is not proof of factual grounding.

## Deterministic Monthly Calculation

For each option/activity, aggregate enabled additions and reductions before replacements:

```text
available = baseline events + sum(add events) - sum(reduce events)
original = available - sum(replacement events)
cost = original * original cents/event + sum(replacement events * replacement cents/event)
time = original * original minutes/event + sum(replacement events * replacement minutes/event)
```

- Add baseline fixed costs and enabled fixed Tag cost/time. Results must not depend on Tag order.
- Negative availability and replacement overflow are errors; never clamp, truncate, or prioritize replacements by array order.
- Missing/unconfirmed baseline or enabled numerical Tag fields block calculation. Incomplete disabled Tags do not, but malformed structures/references always fail.
- Keep invalid configurations editable, hide current totals, and disable story generation; never present old valid totals as current.
- Totals and breakdown come from the same pass. Breakdown kinds are baseline fixed, original activity, replacement activity, and Tag fixed.
- All deltas consistently mean option B minus option A.
- Dashboard includes monthly cost/time, differences, separate charts, and expandable breakdown; handle every sign combination and ties.
- Any optional savings-per-additional-hour metric must avoid division by zero and must not be labeled the user's value of time. Not all tracked time is commute time.

## Deterministic Per-use Comparison

- `break_even` uses shared singular `usageUnit` and per-option `usageCosts: { upfrontCents, perUseCents }`, both NumericFields.
- At the same integer use count for both options: cumulative cents = upfront cents + per-use cents × uses.
- A positive crossover requires higher upfront cost and lower per-use cost. Preserve the exact numerator/denominator and first complete use at equal-or-lower cost.
- Equal lines and no positive crossing are explicit results; unsafe cumulative chart values are not rounded into apparent precision.
- Show editable costs, cumulative-cost chart, and crossover without requiring monthly frequency or time inputs. Missing prices remain unknown.
- Chart range is a local display setting. Do not turn a cup-count threshold into a calendar payback date without consumption-frequency modeling.
- Reference example: $300 + $1/cup versus $0 + $6/cup crosses at 60 cups; changing upfront cost to $400 gives 80 cups.

## Deterministic Subscription Comparison

- `subscription` uses per-option `subscriptionCosts: { paymentCents: NumericField, periodMonths: integer }`.
- Year/month mean periods of twelve/one months; period and optional `comparisonMonths` are each 1–120.
- If no window is supplied, visibly offer twelve months as an editable scenario setting, not predicted actual usage. New generation must retain an explicitly stated comparison window; a narrow guard checks explicit window phrases without confusing payment periods with the window.
- Cumulative payment at month m is `ceil(m / periodMonths) * paymentCents`; month zero is before starting and costs zero.
- Charge complete periods upfront and renew when the selected window requires more coverage. Never silently amortize annual fees or assume refunds.
- Show a payment-step chart, total payments, payment counts, and coverage extending beyond the selected window.
- Backend reconciliation checks the full timeline and fourteen exact story facts. Window changes increment the simulation version without model calls.
- Example: $600/year versus $60/month costs $600/$360 at six months, $600/$720 at twelve, and $1,200/$780 at thirteen.
- Subscription factors describe qualitative concerns such as routine, schedule changes, immediate budget, changing needs, relocation, and renewal responsibility.

## State and Story Contract

- Canonical state is `{ decision, enabledTagIds, simulationVersion }`; initialize enabled IDs to `[]`.
- Edit fields in the decision; do not duplicate mutable `enabled`, `tagValues`, totals, or display-unit frequency state.
- Keep temporary input strings in component state. Preserve committed parameters and importance when factors are disabled/re-enabled.
- Committed baseline, numerical factor, enabled-factor, importance, and comparison-window changes increment the simulation version.
- Stories retain the immutable request snapshot/version. Edits mark them stale; regeneration is explicit. An in-flight response must stay attached to its original configuration.
- Backend independently reconstructs calculations, references, enabled IDs, versions, and the exact fact inventory before making a story model call.
- Project only configured routines, enabled adjustments/considerations, neutral background where applicable, and validated facts. Exclude original raw input, disabled factors, and raw numeric-field metadata.
- Model supplies text slots; backend owns decision IDs, option IDs, version, ordering, and deterministic summary insertion. Invalid legacy metadata is rejected.
- Use shared circumstances and corresponding stages for both paths; option-specific situations must stay grounded in their configured activities and selected factors.
- Quantitative General day uses Morning/Daytime/Evening and monthly reflections. Campus day adds shared arrival/departure anchors with program-calculated travel times.
- Campus timelines depict one illustrative day; monthly results describe the full configuration. Six Uber trips/month must not imply daily Uber use.
- Qualitative, break-even, and subscription stories use corresponding Beginning/During/Later moments and empty monthly reflections.
- Qualitative facts contain only the two option names; per-use/subscription facts contain independently reconciled costs and comparisons.
- Actual numerical claims use validated fact references. Reject unsupported numeric claims and unsupported calendar-payback conversions.
- Monthly cost/time comparison facts are accepted as a complete pair and reconstructed exactly; legacy inventories without that pair remain accepted.
- Story responses support optional paired `advice: [{ optionId, text }, { optionId, text }]`, validated like narrative text. New requests should provide practical advice for both paths; older responses without advice remain readable.
- Advice proposes actions; it does not silently add expenses, time, or activities. Paired slots and conditional wording alone cannot guarantee narrative alignment or quality.

## Generation Reliability and Model Access

- `scripts/generate-contract.mjs` derives the backend prompt JSON Schema from frontend Zod. A regression test detects drift; prompt guidance is not provider-enforced constrained decoding.
- Before generation validation, null fields labeled `user_input`/`derived` can be relabeled `unknown`; never supply a missing number or hide malformed fields.
- A conservative guard clears otherwise-valid known values when input has no possible numeric/free/no-fee evidence. It is not a complete provenance proof for inputs containing some quantities.
- Explicit annual/upfront charges cannot enter new monthly fixed-cost fields; route to the supported appropriate mode or preserve uncertainty.
- New-generation semantic checks reject clear baseline-cost duplicates, opposing-option consideration targets, and daily/weekly frequency labels that the monthly editor cannot implement. The frequency conversion only changes counting units (for example, round trips to one-way trips); never infer a days-per-month multiplier.
- One semantic repair includes actionable field/numeric-claim feedback. Authentication/configuration failures and provider availability are separate concerns.
- Fast HTTP 429/500/502/503/504 responses may retry the same request once, starting within ten seconds; recognized Retry-After must be at most two seconds (otherwise no retry); default delay is one second.
- Do not automatically retry authentication/configuration errors, empty/unreadable successes, or transport/read timeouts. Truncation produces `MODEL_RESPONSE_TRUNCATED` rather than semantic repair.
- Log only status/exception class, attempt, and elapsed time; never credentials, prompts, provider bodies, or exception messages.
- Actual-model checks have succeeded with `nvidia/nemotron-3-super-120b-a12b`; this model uses low-effort reasoning and a 1,024-token reasoning budget.
- Previous disclosure of a key requires rotation; successful access is not evidence of rotation. Never put credentials in chat, memory, Git, frontend code, or `VITE_*` variables.

## Stack, Entry Points, and Local Commands

- React + TypeScript + Vite; Tailwind/shadcn-style Radix components; Zustand; Recharts; Zod; pure TypeScript simulation; Vitest.
- Java 21 + Spring Boot 3.5.7 + RestClient; versions are pinned in `frontend/package-lock.json` and `backend/pom.xml`.
- API: `GET /api/health`, `POST /api/scenarios/generate`, `POST /api/stories/generate`.
- Backend environment: `NVIDIA_API_KEY`, `NVIDIA_MODEL`; optional `NVIDIA_API_URL` and `NVIDIA_TIMEOUT_SECONDS` (default 60).
- Default provider endpoint: `https://integrate.api.nvidia.com/v1/chat/completions`. Spring Boot does not automatically load `.env.example`.
- Frontend dev: `npm --prefix frontend run dev` at `127.0.0.1:5173`, proxying API to localhost:8080.
- Backend dev: select Java 21 (macOS default was Java 17), then run `./mvnw spring-boot:run` inside `backend/`.
- Offline checks: `npm --prefix frontend test`; `node --test scripts/verify-scenarios.test.mjs`; `npm --prefix frontend run build`.
- After frontend build, run `./mvnw -Pbundle-frontend package` inside `backend/`; copy the completed JAR to a separate runtime path before launching the localhost:8080 demo. Never overwrite a running JAR through a later build. On 2026-09-20 the API remained healthy while `/` returned 404 after the active target JAR was replaced; rebuilding and launching a separate copy restored the homepage, JS/CSS, and browser rendering.
- Live harness: `node scripts/verify-scenarios.mjs --live --concurrency 1 --output /tmp/dayfork-case-checks` with an already configured backend.
- The harness uses real frontend validators/calculators, makes no requests without `--live`, never reads `.env`, and keeps detailed artifacts outside Git by default.
- Current demos: campus housing (nine factors: six numerical, three considerations), gaming/office laptop, coffee costs, annual/monthly membership, and labeled offline stories.
- Frontend core: `frontend/src/domain/{simulate,qualitative,break-even,subscription}.ts`, `frontend/src/store.ts`, and comparison/story components in `frontend/src/components/`.
- Backend counterparts: `ContractValidator`, `SimulationReconciler`, `BreakEvenReconciler`, `SubscriptionReconciler`, `StoryModelInput`, `StoryDraftAssembler`, `StoryValidator`.

## Verification Evidence (2026-09-20)

- Original scenario-contract acceptance: 41 frontend + 112 backend tests, both production builds, and successful live scenarios across seven corpus inputs over multiple runs; four final stories returned HTTP 200.
- Qualitative acceptance: 52 frontend + 188 backend + 9 harness tests, builds, desktop/390px checks, actual laptop scenario/story, and investment story success after an explicit provider-error retry.
- Per-use/importance acceptance: 68 frontend + 249 backend + 15 harness tests (332 total), builds, desktop/mobile checks, and independent inspection of 625 cost combinations.
- Actual QQQ/CD scenario and story succeeded with selected importance. Missing-price coffee stayed break-even; supplied coffee crossed at 60 cups.
- A live coffee story incorrectly referred to months; a targeted guard and deterministic crossover insertion were added, and the final live repeat used cup counts correctly.
- The reported QQQ invalid-output error was not reproduced; a provider 503 followed by explicit successful retry does not establish its original cause.
- Membership/story implementation: 94 frontend + 370 backend + 21 harness tests passed (485 total); production frontend build and bundled backend package passed.
- Packaged browser checks passed for fee entry, 6/12/13-month payment totals, unknown amounts, nine visible campus factors, three importance sliders, local-only edits, paired advice, stale stories, and interactive corresponding stages at desktop and 390px widths.
- Actual chart SVG dimensions, axis labels, and line/bar geometry were verified for subscription, coffee, and campus charts across repeated desktop/mobile resizes. Duplicate React keys and a zero-width responsive chart defect found during these checks were corrected.
- Real-model review exposed omitted explicit comparisonMonths, baseline-duplicate factors, opposing targets, unsupported subscription rights, misleading frequency labels, and generic campus scenes. Captured regressions and targeted generation/story guidance were added; final live acceptance is being recorded in `docs/membership-stories-validation-2026-09-20.md`.
- Historical reports: `docs/scenario-validation-2026-09-20.md`, `docs/qualitative-validation-2026-09-20.md`, `docs/break-even-validation-2026-09-20.md`.
- Read older report boundaries in context: annual membership previously routed qualitatively; current subscription support supersedes that limitation. Initial six-factor visibility and fixed 5–10 generation quotas are also obsolete.
- No maintained automated browser regression suite is established. Historical browser checks and temporary artifacts are evidence for the runs described, not a reliability guarantee.

## Monthly Acceptance Fixture

Near: $1,500/month rent, 40 one-way events/month, $0/event, 10 min/event.
Far: $1,100/month rent, 40 one-way events/month, $0/event, 40 min/event.
These are known fixture values, not defaults for missing real-world input. Far's Uber replacement costs $25 and takes 20 minutes per one-way event.

| Independent configuration | Near cost / time | Far cost / time |
| --- | --- | --- |
| No Tags | $1,500 / 400 min | $1,100 / 1,600 min |
| Uber 6 | $1,500 / 400 min | $1,250 / 1,480 min |
| Uber 10 | $1,500 / 400 min | $1,350 / 1,400 min |
| Reduce both by 8; Far Uber 6 | $1,500 / 320 min | $1,250 / 1,160 min |
| Add 10 to both; Far Uber 6 | $1,500 / 500 min | $1,250 / 1,880 min |
| Far 32 available; Uber 20 + Drive 15 | Entire comparison invalid | No current totals |

Uber 6 saves Far $250 for 1,080 extra minutes; Uber 10 saves $150 for 1,000 extra minutes. Editing 6 → 10 adds $100 and removes 80 minutes.
Also preserve baseline restoration, zero-frequency behavior, original-cost/time deductions, fixed-pass retention, order independence, unknown handling, visible overflow errors, and breakdown reconciliation.

## Remaining Limits and Unresolved Suggestions

- Demo deadline and available implementation time remain unspecified.
- Arbitrary scheduled cashflows, financing, depreciation/resale, investment growth, cancellation/refund/penalty/pause rules, changing prices, and partial monthly metrics are not implemented.
- Unsupported effects may be explored qualitatively without invented time/event inputs. The product is not a full relocation, career, tax, immigration, or investment adviser.
- Provider availability, narrative semantic alignment, unsupported nonnumeric claims, and suggestion quality remain limitations despite structural validation.
- Browser-local persistence/restore validation, custom Tags, latest-change animation, and an optional per-hour metric remain P1 suggestions. There are no accounts or cross-device state.
- Editing inside story scenes, a monthly scene index, personal constraints, general threshold solvers, calendar allocation, and deadline planning remain proposals, not authorized replacements for the core flow.
- Suggested next work: finish subscription/story acceptance and its report; add durable browser coverage for invalid edits, stale/in-flight stories, narrow layouts, and local-only controls; review actual narrative failures before adjusting prompts/guards.
