# Membership payments, mixed factors, and parallel stories

Date: 2026-09-20. Scope: local development and demonstration.

## Implemented behavior

- `year card or month card` uses the subscription comparison, including separate editable payment amounts. Missing amounts stay unknown and visible for entry.
- The comparison window is editable from 1 to 120 months. An unspecified window visibly defaults to 12 months as a comparison setting, not predicted usage.
- The deterministic calculation charges full billing periods. At $600/year and $60/month, six-month costs are $600/$360, twelve-month costs are $600/$720, and thirteen-month costs are $1,200/$780. The last case has 24/13 months of paid coverage; unused annual coverage is shown explicitly.
- Membership factors address relevant independent concerns, typically five to seven for a broad question. Broad campus housing aims for eight to ten factors with numerical adjustments and qualitative considerations. This is scenario-specific coverage, not a global quota. Narrow questions can use fewer factors, and larger sets can expand beyond the ten initially visible.
- The campus demo has nine factors: six numerical adjustments and three qualitative considerations. Optional importance levels of 1–5 affect story emphasis only. Numerical factors affect the calculation and summary.
- Stories now depict possible experiences at corresponding stages, with practical advice for each option. An interactive two-path timeline links those stages. Advice remains optional for compatibility with older responses.
- All parameter and factor edits remain local. Existing stories become stale until explicitly updated.

## Automated verification

- Frontend: 94 tests across 11 files passed.
- Backend: 392 tests passed, with no failures, errors, or skips.
- Scenario harness: 21 tests passed.
- Frontend production build and bundled backend package succeeded.
- `git diff --check` passed.

New checks cover whole-period payment boundaries, unknown prices, overflow, frontend/backend reconciliation, story fact identity, optional paired advice, campus coverage, and observed model semantic failures. Existing monthly, qualitative, per-use, and QQQ regressions remain included.

## Browser verification

The packaged application passed local Chromium checks at 1440px and 390px:

- Separate annual/monthly payment inputs; an unknown-price response still exposes both fields.
- Window edits through 12 → 6 → 13 → 12 months update totals and maintain one comparison panel.
- Six membership factors and all nine campus factors are initially visible.
- Three campus importance sliders; qualitative edits leave the numerical chart unchanged, while the utilities adjustment changes it.
- No model requests from local edits; exactly the explicit mocked scenario request occurred in the scenario-entry test.
- Paired advice, corresponding-stage navigation, and stale-story feedback.
- No page errors or horizontal overflow.

A separate chart check verified actual SVG size, axis labels, two nonzero line/bar shapes, and intersection with the viewport. It covered membership, coffee break-even, and both campus charts over repeated desktop/mobile resizes. Membership and coffee SVG sizes were 1142 × 288 on desktop and 308 × 288 on mobile; campus charts were 540 × 192 and 308 × 192. These checks caught an initial zero-width rendering defect that accessible chart labels alone did not reveal. The final components use Recharts native responsive layout.

Temporary browser scripts and screenshots were saved under `/private/tmp/dayfork-membership-browser` and `/private/tmp/dayfork-chart-visibility`. They document this run; a maintained browser test suite has not yet been established.

## Actual-model review

Initial real-model results were structurally valid but revealed material narrative and Tag issues:

- Campus factors restated baseline rent, utilities, groceries, commute time, and laundry frequency as additive adjustments. Filling their original amounts would double count the baseline.
- Some membership considerations referred to the opposite option or proposed an unmodeled mixed billing strategy.
- A membership story assumed a right to skip a payment and treated the comparison-window end as the end of the user's need.

The captured failures were added as regression fixtures. New-generation checks reject clear baseline duplicates and clear opposing-option targets, while preserving legitimate incremental services and older loaded decisions. Subscription story checks reject the observed unsupported payment rights and end-of-window assumptions. Prompts require shared external circumstances, branch-specific billing continuity, possible experiences, and practical advice grounded in actual terms.

A second real-model pass returned the correct subscription route for the exact short input (six factors) and eight mixed campus factors. It also exposed a missing `comparisonMonths` field despite an explicit thirteen-month request. The calculator correctly used its documented default; the generation layer had failed to preserve the requested window. A targeted explicit-window validation and captured failure fixture were added.

Further review found an unsupported daily frequency label in a monthly campus input and a campus story that reserved its selected qualitative concerns for advice. Generation now rejects daily/weekly labels that the monthly frequency editor cannot implement. Story guidance requires selected concerns to appear in possible lived scenes, keeps privacy conditional, and distinguishes shared campus arrival/departure from each option's home arrival.

The next thirteen-month scenario retained `comparisonMonths: 13` and the supplied payment amounts. Its story request hit a provider 503; an explicit repeat then failed the strict text validator because it emitted the known payment as literal `$600` instead of a fact placeholder. The updated campus-story request encountered a provider timeout. These are separate observed failures and are not counted as successful story acceptance.

Known dollar literals now become fact references only when their exact cent value matches a unique allowed money fact. Unknown or ambiguous values, ordinary numbers, percentages, and malformed amounts remain invalid. A later HTTP 200 story exposed invented written-out attendance counts such as “three times a week”; these were captured and a narrow frequency guard was added. This illustrates why an HTTP success alone is insufficient narrative acceptance.

The final campus generation returned nine factors: five numerical adjustments and four qualitative considerations. The rideshare factor now uses `replace_activity` with independent cost/time inputs; frequency labels use `Round trips` and preserve a two-one-way-trip conversion. Missing prices remain unknown and correctly require baseline review.

The final live campus story returned HTTP 200 with paired advice. Its evening scenes incorporate the selected social-connection and privacy concerns. The browser confirmed the story renders, corresponding-stage navigation works, and desktop/mobile layouts remain within the viewport. The earlier provider timeout is preserved separately.

The final membership prompt focuses on lived experiences and practical actions; numerical billing details stay in the chart and program-generated summary. The same thirteen-month request then returned HTTP 200 with paired Beginning/During/Later scenes and advice. Both branches use the same schedule change, and the response contains no invented numeric attendance frequency. The canonical summary retains the computed $1,200/$780 comparison over thirteen months.

Final live evidence:

| Check | Observed result |
| --- | --- |
| Exact `year card or month card` | HTTP 200; subscription mode, periods 12/1, unknown prices, six factors |
| Explicit thirteen-month gym comparison | HTTP 200; preserved window and $600/$60 payment inputs; deterministic $1,200/$780 totals |
| Final membership story | HTTP 200; paired experiences and advice; code-owned cost summary |
| Broad campus housing | HTTP 200; nine factors, five numerical and four qualitative; missing baseline values remain unknown |
| Mixed-factor campus demo story | HTTP 200; social/privacy scenes and paired advice, verified in the browser |

Detailed local artifacts are in `/private/tmp/dayfork-membership-final-live`, `/private/tmp/dayfork-membership-accepted-live`, `/private/tmp/dayfork-campus-final-live`, and `/private/tmp/dayfork-live-campus-story`. Earlier failing responses remain distinguishable from final accepted outputs. The final membership response is `story-experience-response.json`; HTTP 200 alone was not treated as narrative acceptance.

The user-facing demo at `http://127.0.0.1:8080` was refreshed from a separate immutable runtime JAR. Its complete fee/factor/story interaction check and all twelve chart resize checks passed before the final backend-only story refinement; the final JAR received a health, homepage, asset, and membership-panel smoke check.

## Limits

The subscription calculator does not model refunds, cancellation penalties, price changes, or pause rules. A comparison window is not a prediction of how long the user needs the service. Arbitrary cashflow schedules and investment growth remain unsupported numerically and can be explored qualitatively.

Structural validation and narrow semantic guards do not prove every generated statement correct. Shared narrative circumstances and suggestion quality still require qualitative review. No provider availability guarantee follows from successful local requests.
