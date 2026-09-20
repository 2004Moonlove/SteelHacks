# Per-use comparison and factor importance validation

Date: 2026-09-20

## Implemented behavior

- New version-two `break_even` comparisons keep upfront and per-use prices separate, without monthly frequency or time inputs. Missing prices remain editable unknowns.
- Costs are calculated as upfront cents plus cents per use times use count. Exact rational crossings and the first complete use are calculated with integer arithmetic. Equal, noncrossing and unsafe cumulative amounts have explicit handling.
- Story requests carry independently reconciled cost facts. Break-even narratives use shared Beginning, During and Later stages.
- Factor counts have no complexity-based quantity quotas. The existing technical maximum of 30 remains; grouped expansion is a display choice, not a generation quota.
- Consideration factors offer optional importance from 1 to 5. An unset value does not imply a default preference. Values can be cleared and survive disabling/re-enabling a factor. Only enabled factors reach the model, with natural-language priority labels.
- Price edits, chart-range edits, factor toggles and importance changes make no model calls. Relevant snapshot edits mark existing stories stale.
- Newly generated decisions must use v2. Existing v1 decisions and story requests remain supported. Model-authored notes cannot establish a missing price as zero.

## Verification

Frontend: 68 tests passed, including eleven break-even cases and five preference-state cases. Backend: 249 tests passed, including cross-language facts, tampered results, legacy compatibility, QQQ repair cases and the observed calendar-payback regression. Scenario harness: 15 tests passed. Total: 332 automated tests. Production frontend build and bundled Spring Boot packaging passed. Existing build warnings concern bundle size and third-party annotation placement.

Browser checks on desktop and a 390px viewport passed: a 60-use threshold changes to 80 after editing the upfront price; no forced monthly/time inputs; missing prices retain the per-use route; local controls produce no requests; sliders support keyboard input and preserve preferences; changed preferences mark stories stale; two-factor and twelve-factor cases render and expand correctly; explicit story requests carry selected importance. No page errors or horizontal overflow were observed.

An independent review checked 625 cost combinations including maximum safe integers. It also checked Java/TypeScript crossover agreement, strict story facts, disabled-factor exclusion, stale-response handling and chart overflow behavior.

## Actual model checks

- Exact `QQQ ETF vs Certificate of Deposit`: scenario and story both returned HTTP 200 in the new browser flow. Five factors were returned. Selecting factors and importance made no additional requests until explicit story generation; the request included the user's highest importance setting. A subsequent slider edit marked the story stale without contacting the model.
- `Coffee Machine vs Buying Coffee at Starbucks`: HTTP 200, `break_even`, three factors, with all absent prices retained as unknown. No synthetic prices or story were supplied by the harness.
- Supplied coffee costs of $300 upfront and $1 per cup versus $0 upfront and $6 per cup: scenario and story returned HTTP 200, and the independently checked crossover was 60 cups.

The originally reported QQQ `MODEL_OUTPUT_INVALID` response did not recur in these checks. An earlier diagnostic story call returned provider-unavailable HTTP 503, followed by HTTP 200 on an explicit retry. This does not establish the cause of the original report or guarantee provider availability. A captured synthetic QQQ request now exercises valid long-term output and bounded repair for unsupported digit-bearing narrative claims, without relaxing the numeric guard.

Manual review caught a coffee narrative changing a cup-count comparison into “how many months” despite lacking consumption frequency. A targeted response guard now rejects unsupported calendar-payback conversions and permits one bounded repair. Application code inserts the canonical crossover sentence when the model omits it. After repackaging, a new actual-model run returned HTTP 200 for both scenario and story, retained the 60-cup threshold, included `{{breakEvenSummary}}`, and used cup counts throughout. It produced zero redundant Tags for the tightly specified cost-only input; optional factor UI correctly remains absent for that case. Structural success alone is not proof that all narrative wording is grounded.

Local synthetic run artifacts are under `/private/tmp/dayfork-break-even-live`, `/private/tmp/dayfork-break-even-final-live`, `/private/tmp/dayfork-qqq-live-browser` and `/private/tmp/dayfork-break-even-browser`. They contain no model credentials. These temporary artifacts are not required to run the app.

## Remaining limits

The per-use model assumes the entered costs apply across the selected use counts. It does not model repairs, depreciation, resale, financing, scheduled cashflows or investment growth. Factors can express relevant uncertainties without assigning them invented numerical effects. Qualitative investment stories do not calculate returns or recommend a product. Browser-local persistence and cross-device accounts remain outside this change.
