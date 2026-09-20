# Qualitative decision flow validation — 2026-09-20

The qualitative path is implemented and verified locally. It retains two option identities but skips numerical baseline review, option metric cards, charts, breakdowns, and monthly reflections. Users select relevant consideration Tags and explicitly generate corresponding Beginning, During, and Later storylines.

## Automated checks

- 52 frontend tests passed, including the shared qualitative request fixture, no synthetic zero totals, zero/simple/complex factor counts, invalid reference rejection, and unchanged numerical results for mixed Tags.
- 188 backend tests passed, including all previous cases, strict qualitative request/response identity and fact inventories, selected-only story projection, conditional/question-based generated considerations, and bounded recovery for an annual fee placed in a monthly field.
- 9 scenario-harness tests passed, including qualitative story-request construction, legacy/v2 bounds, exact moment ordering, and no-network defaults.
- Frontend production build and bundled Spring Boot package passed. Existing frontend dependency annotation and bundle-size warnings remain non-fatal.

## Browser acceptance

Isolated Chrome checks covered desktop and 390-pixel layouts:

- The labeled laptop demo opens factor selection directly, with no numerical inputs, cost/time charts, campus-day controls, or monthly reflection.
- Selecting factors and using the offline preview make no model requests. Selected considerations appear in the preview; later changes mark it stale.
- An intercepted two-factor scenario verifies the exact outgoing selected IDs, qualitative calculation status, and names-only facts. Changing a selection during generation leaves the returned story attached to the old snapshot and visibly stale.
- A twenty-factor scenario expands from six visible factors, preserves selections through collapse/expand, and displays groups.
- A zero-factor qualitative scenario retains story generation and omits the empty factor section.
- A quantitative housing decision with a consideration Tag preserves its numerical totals and existing comparison components.
- No browser runtime errors or narrow-layout horizontal overflow were observed.

A separate browser run used the real model without API interception for the exact input `Should I buy a gaming laptop or an office laptop?`. Scenario and story requests both returned HTTP 200. The response contained three consideration Tags; selecting two sent those exact IDs and produced both ordered storylines. A subsequent toggle marked the story stale. The complete workflow issued exactly two API requests: scenario generation and explicit story generation.

## Live scenario checks

| Case | Final observed result |
| --- | --- |
| Gaming versus office laptop | Qualitative scenario and story both HTTP 200; three Tags |
| Annual versus monthly gym membership | Qualitative scenario and story both HTTP 200; no annual-fee monthly equivalent |
| QQQ versus CD | Qualitative scenario HTTP 200; story initially HTTP 503 `MODEL_UNAVAILABLE`, then HTTP 200 on one explicit retry of the same saved request |
| Supplied monthly membership versus per-visit gym | Quantitative scenario and story both HTTP 200; expected deterministic costs and time matched |

Earlier live attempts exposed two issues that were fixed: an annual charge was assigned to `amountCentsMonthly`, and a narrative copied digit-bearing text such as `3D` into a numeric-claim-protected slot. Generated-v2 nonmonthly payment labels now trigger the existing bounded repair, while numeric repair feedback identifies the offending token without loosening validation. Generated consideration targets must be questions or explicit conditions. The first failed runs were retained separately rather than overwritten as successful results.

Detailed local artifacts are in `/private/tmp/dayfork-qualitative-browser`, `/private/tmp/dayfork-qualitative-live-browser`, `/private/tmp/dayfork-qualitative-live`, and `/private/tmp/dayfork-qualitative-final-live`. They use synthetic questions and do not contain credentials. The investment retry is recorded separately as `story-explicit-retry.json`.

## Implementation boundary

This change adds qualitative routing and mixed narrative factors. It does not implement scheduled cashflows, annual contract/refund calculations, or investment return projections. Those choices use the qualitative path when their central numerical semantics do not fit the existing monthly engine. Missing values in an otherwise calculable recurring comparison still require numerical baseline review.

Question/conditional phrasing and structural validation do not prove narrative factual correctness. Stories remain illustrative; real model wording can still introduce or emphasize routine details beyond the selected concerns, and requires qualitative review. Provider availability is also independent of local contract validation.
