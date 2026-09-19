# Clear Choice acceptance record

Date: 2026-09-19. Host: Windows, Node.js 24, Java 21. Work started from a clean `Yang` checkout at `cfeeb68`, the same commit as local `main`. Development branch: `codex/clear-choice`.

## Verified implementation

- Frontend pure-function tests: **66 passed** (47 Clear Choice tests and 19 preserved Dayfork/unit tests).
- Backend tests: **40 passed** (18 Clear Choice contract/service tests, 5 NVIDIA transport tests, 17 preserved scenario/story/regression tests).
- Browser acceptance: **8 passed** in local Chrome. The no-ad/desktop/mobile flow was rerun after disabling chart animations to keep displayed bars aligned with current values; it passed.
- TypeScript production build and generated-schema consistency check passed. Java 21 Spring Boot packaging passed. Final packaged HTTP checks and live-evaluation configuration status are recorded below after execution.
- Desktop and 390px mobile screenshots were inspected. The mobile regression asserts no horizontal overflow. Charts use current controlled data and do not fabricate values for unknown dimensions.
- The original Dayfork source, deterministic v1 engine, APIs and tests remain in place. `/#legacy` exposes the old application.

## Acceptance coverage

| Requirement | Evidence |
| --- | --- |
| Complete comparison without any advertising | Browser no-ad flow plus 0/0 material unit case |
| Unrecognized scenario has a general path | Browser manual observatory case with three options; open-domain unit comparison; mocked understanding response |
| Explicit requirements vs suggestions | Java source/quote validation and review normalization; unconfirmed hard requirements stay unresolved; model semantic completeness remains a live-evaluation question |
| Unknown values are not zero or automatically failures | Engine missing-price/billing/constraint tests; browser unknown/invalid/no-solution states |
| Custom factors persist and affect the stated purpose | Browser add, edit, enforce, reload, remove; suggestion merge preservation tests |
| Zero, one, many materials and per-option ownership | Unit combinations 0/0, 1/0, 2/0, 1/1, 2/2; browser two materials on A and one on B |
| Same facts, different marketing language | Exact objective comparison equality in unit tests before/after adding or rewriting materials |
| New material values do not overwrite known data | Java immutable-request test; browser conflicting-price confirmation and stale-analysis test |
| Multiple tags and original quotes | Java multi-tag/evidence tests and browser conflict display; invented/cross-option quotes rejected |
| Normal marketing vs missing materials | Java no-material/no-model-call test and clear-disclosure validation; UI keeps these distinct |
| Shared and option-only parameter edits | Frequency/horizon/budget browser edits and isolated-price engine test |
| Calculations, plots and summary agree | Current result used by all components; curve endpoint/summary unit test; visible browser totals and summaries |
| Old responses cannot overwrite edits | Browser delayed factor response after horizon edit; server/client version validation |
| Failure handling and credential protection | Real local missing-configuration API check, mocked invalid JSON with one repair, timeout/header/body/empty-response/429/502 tests; no frontend credentials |

## Fictional calculation fixtures

Memberships have identical unlimited access and no other fees. Annual payment is 1,200 CNY every 12 months; monthly payment is 150 CNY every month, with no refund assumption.

| Use horizon | Annual cash outflow | Monthly cash outflow | Lower total |
| --- | --- | --- | --- |
| 4 months | 1,200 CNY | 600 CNY | Monthly |
| 8 months | 1,200 CNY | 1,200 CNY | Tie |
| 9 months | 1,200 CNY | 1,350 CNY | Annual |
| 13 months | 2,400 CNY | 1,950 CNY | Monthly after annual renewal |

Changing weekly visits changes the cost per modeled visit and routine time, not these fixed-payment totals. Housing and course fixtures are also explicitly fictional. No fixture contains preset material-analysis findings.

## What the model tests do and do not prove

Java tests use a fake `ModelClient` or a local HTTP test server. Three browser flows intercept model endpoints to exercise validated result display, price confirmation, errors and stale responses. These are **mock integration tests**, not evidence of live Nemotron language understanding or analysis quality.

The seven-case `npm run eval:model` harness uses real backend requests and records a blocked status if credentials/model configuration are absent. Its cases cover laptop purchase/wait, repair, Chinese housing with cat/commute constraints, Chinese memberships, weekend work, courses and an open-domain choice. Passing structural checks would still require manual review of omissions, unsupported inference, meanings of quotes and advice quality.

NVIDIA's documented [Nemotron 3 Super model](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard) supports English and Chinese. This establishes documented capability, not access or quality on this account. No selected model has passed live acceptance on this Windows host.

## Remaining capabilities and limits

- Live Nemotron evaluation and real material semantic acceptance need `NVIDIA_API_KEY` and `NVIDIA_MODEL` in the backend environment.
- Clear Choice summaries are immediate deterministic templates; optional model polishing is not implemented. Legacy Dayfork story generation remains available separately.
- OCR, screenshot/file ingestion, URL collection and public deployment are not implemented.
- Rules model one common use frequency, whole-month billing, one currency and additive cost/time components. They do not implement actual calendar schedules, foreign exchange, automatic refunds, partial-month proration or arbitrary causal chains.
- Exact-name/rule deduplication is implemented. Synonym-level deduplication remains reviewable model/user judgment.
- Invalid drafts are held on screen, but reload restores the last valid browser save. Material-analysis findings are held in workspace memory, while material text and confirmed values persist locally.
- `npm audit` reported two moderate findings in the existing Vitest development dependency tree (`vitest`/`@vitest/mocker`, GHSA-82fw-gwwq-j7x9). Resolving them requires a major test-tool upgrade. Production dependency counts reported no advisory, and the test UI server is not exposed by the verification commands. No unrelated major upgrade was applied.
- Vite reports a large shared application/chart bundle warning. Production build succeeds; further splitting is optional performance work.
