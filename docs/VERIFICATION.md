# Clear Choice verification

This file separates implemented behavior, fictional demonstration content and real model evaluation. It is completed from observed results, not inferred from prototype behavior.

## Provenance and scope

- Base branch: `yy`, commit `449e9f3`; development branch: `codex/clear-choice`.
- This task never checked out, merged or reset `main`. The initial local `main` was `cfeeb68`; a separate repository operation fast-forwarded it from `yy` to `449e9f3` at 18:02:47 (observed in its reflog). The final local and remote `main` are `449e9f3`, and that state is preserved. Only `codex/clear-choice` receives this implementation.
- Pre-existing changes to `.env.example`, `MEMORY.md`, `README.md`, `StoryValidator.java` and `GenerationServiceTest.java` are preserved. The original README is also retained in `docs/LEGACY_DAYFORK.md`.
- The provided standalone HTML files informed interaction design. Their preset material findings are not used as evidence of real model analysis.
- Offline examples are fictional. The v2 summaries are deterministic text from the same arithmetic as the charts. There is no v2 model prose-generation claim.

## Acceptance checklist

| Area | Verification method | Result |
| --- | --- | --- |
| Gym 4/8/9 months and usage independence | Pure-engine tests | Passed: 43 v2 domain tests + 19 legacy tests |
| Annual renewal, first payment, complete costs, overflow, missing dependencies | Pure-engine tests | Passed: 43 v2 domain tests + 19 legacy tests |
| Hard requirements, unknown eligibility, no feasible options, primary ties | Pure-engine tests | Passed: 43 v2 domain tests + 19 legacy tests |
| User factors, duplicate suggestions, model proposals | Domain and browser tests | Passed: 13 Chromium acceptance tests |
| No materials / one / multiple / one or multiple options | Backend and browser tests | Passed: validation suites and 13 Chromium acceptance tests |
| Material wording does not alter facts or totals | Domain and browser tests | Passed: 13 Chromium acceptance tests |
| Exact citations, units, extraction confirmation, stale response rejection | Backend and browser tests | Passed: validation suites and 13 Chromium acceptance tests |
| Charts and summaries follow current input | Browser tests | Passed: 13 Chromium acceptance tests, desktop and 390px viewport |
| Open generic comparison and model error retention | Browser tests | Passed: 13 Chromium acceptance tests, desktop and 390px viewport |
| Chinese free text and real model output | Opt-in live evaluation and real browser flow | Passed the three final generation cases and all final follow-up checks; see observed retries and limitations below |
| Production frontend and packaged backend | Build and localhost checks | Passed: packaged Clear Choice page, exact gym totals, no page errors, legacy route, desktop and 390px viewport |

## Remaining capabilities

Screenshot OCR, uploaded-file parsing, website collection, external factual verification, public deployment, accounts and cross-device storage are not implemented. Model-polished v2 prose is optional and not implemented; deterministic summaries update immediately. Supported billing uses whole monthly horizons and explicitly entered charges. Loan schedules, taxes, partial-month proration, automatic currency exchange, refunds and uncertain causal forecasts are not generated. These are extension boundaries, not silently assumed facts.

## Offline verification evidence

- Frontend: 62 unit tests passed (43 new v2 tests and 19 preserved v1 tests); TypeScript and Vite production build passed.
- Backend: 110 tests passed, including strict response validation, provider recovery and regressions captured from real model outputs; the bundled Spring Boot package passed.
- Browser: All 13 Chromium acceptance cases passed in one final run. They include a currency-reset/undo and qualitative-assumption check. The later budget-source fix also has a focused domain regression.
- The packaged application at localhost:8081 returned the expected fictional gym totals CNY 1,200 and CNY 600 with no browser page errors. The legacy Dayfork route also loaded.
- No actual configured API key was found in commit candidates; `.env` remains ignored. The browser bundle has no credential configuration. Production dependencies reported no known audit findings at verification time.
- A diagnostic live run was invalidated when an in-use Spring Boot JAR was overwritten by a parallel build. This was a test setup failure, not a provider result. Subsequent live tests run an immutable JAR copied to `/tmp`.

## Real Nemotron evaluation

The selected `nvidia/nemotron-3-super-120b-a12b` ran through the actual backend with `NVIDIA_REASONING_EFFORT=low` and a 60-second per-request timeout. Inputs contain fictional facts, not real merchant evidence. These are actual model calls, distinct from UI demos and offline browser stubs. The [machine-readable record](model-evaluation-2026-09-19.json) retains failed attempts as well as successful retries.

| Final check | Observed result |
| --- | --- |
| Chinese gym decision | Passed real Chromium entry → model → comparison; correct CNY 1,200 / 600 at 4 months, tie at 8, annual lower at 9, budget edits and frequency independence. Explicit primary cost preference retained. |
| Chinese housing requirements | Passed in 19.1 s; cats unknown, commute 10 / 40 minutes against 30-minute hard limit, A pending and B ineligible, incomplete costs unknown. |
| Unfamiliar course / defer decision | Passed in 16.9 s; general comparison with three options, Saturday requirement retained, desired artwork kept as a preference, unstated fees and option properties unknown. |
| No materials | Passed locally in 0 s with zero provider calls; absence is not a safety result. |
| One promotional material | Passed in 3.3 s; the explicit deadline has an urgency finding with an exact quote. |
| Conflicting materials for one option | Passed on retry in 19.6 s with three findings and inconsistent status; the preceding provider-unavailable result is preserved. |
| Materials on another option | Passed in 7.8 s; ordinary monthly terms returned no obvious pressure, independently of the annual option's problems. |
| Natural-language cancellation requirement | Passed after correction in 16.1 s; returned a new factor proposal without overwriting existing factors. Earlier provider-unavailable and unsupported-extra-field results are preserved. |

The gym browser initiated one generation API operation. Server logs show two completed provider responses (one semantic repair) and one transient HTTP 503 retry inside that operation. The later 4/8/9-month, budget and frequency edits made no additional model calls. The page had no browser errors. All three generated decisions also passed the actual frontend schema and calculation engine, not only backend shape checks.

Development-time real calls exposed annual charges classified as one-time, static computed factor values, duplicated monthly usage time and budget constraints, inferred free/defer values, a wish incorrectly upgraded to a hard condition, lost explicit cost priority, missed deadline language, incomplete JSON shapes and non-English generated display notes. Regression tests and bounded validation/normalization address these observed failures. Unsupported top-level metadata in factor suggestions is discarded without mutating the existing decision; factor contents remain strictly checked. Earlier provider-default runs also timed out, and transient HTTP 503 responses still occurred with the final setting. Safe failure and retry remain necessary.

This is a small regression sample, not an accuracy benchmark. Exact source quotes and narrow language guards cannot establish that every model interpretation is semantically correct. Review suggested options, requirements and completeness. Broader unseen-domain/language evaluation and external factual verification remain unverified.

The documented `./scripts/run-local.sh` was also launched on temporary port 8082: the packaged Clear Choice page and configured-model health endpoint passed without a provider call, and the temporary process was stopped. The final preview uses a separate immutable JAR on port 8081.
