# Clear Choice

Clear Choice helps people compare everyday decisions through editable facts, explicit needs and deterministic life previews. Describe a question, review the suggested options and factors, then compare costs, time and tradeoffs. Promotional material is optional and belongs to each option independently.

This branch extends the existing Dayfork React + TypeScript + Vite + Recharts frontend and Java 21 + Spring Boot + Nemotron backend. The previous Dayfork experience remains at `/?legacy=1`; its original documentation is preserved in [docs/LEGACY_DAYFORK.md](docs/LEGACY_DAYFORK.md).

## Local startup

Requirements: Node.js 20.19+ (or a supported newer LTS), npm, and Java 21. From the repository root:

```sh
./scripts/run-local.sh --build
```

Open [localhost:8080](http://127.0.0.1:8080). The script loads the ignored local `.env`, selects Java 21 on macOS, builds and verifies both applications, and runs the packaged application. Later starts can use `./scripts/run-local.sh` without rebuilding. To choose a free port:

```sh
SERVER_PORT=8081 ./scripts/run-local.sh
```

For separate development servers:

```sh
# Terminal 1
cd frontend
npm ci
npm run dev

# Terminal 2, from repository root
set -a
. ./.env
set +a
export JAVA_HOME=$(/usr/libexec/java_home -v 21) # macOS only
cd backend
./mvnw spring-boot:run
```

Open [localhost:5173](http://127.0.0.1:5173). `CHOICE_API_TARGET=http://127.0.0.1:8081 npm run dev` directs the development proxy to a different local backend port.

## Model configuration

Create a local `.env` using the variable names in [.env.example](.env.example):

```dotenv
NVIDIA_API_KEY=your-local-key
NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b
NVIDIA_API_URL=https://integrate.api.nvidia.com/v1/chat/completions
NVIDIA_TIMEOUT_SECONDS=60
NVIDIA_REASONING_EFFORT=low
```

The optional reasoning-effort setting accepts `none`, `low`, or `high`; an empty value retains the provider default. `low` is the current evaluation setting for the selected model.

The key stays in the server process environment and is never returned to the browser. Do not put credentials in `VITE_*`, source files, examples or Git. No credential is needed for manual comparisons or the explicitly labeled fictional examples. Live model errors preserve the current draft and show an error; the app never substitutes a fixture for a model response.

## Comparison rules

- Known subscription, housing and purchase patterns use predefined arithmetic; unfamiliar topics use a general factor comparison. Options and factors remain editable.
- Hard requirements are checked first. Unknown requirements remain pending. An explicit primary preference can then identify a better fit, a tie, insufficient information or no feasible option. No weighted composite score is generated.
- Money uses integer minor units in one selected currency. Durations use minutes. A horizon is 1–120 whole months. Annual fees are paid for each started year; monthly fees for each month. No currency conversion, financing, depreciation or refund is inferred.
- Time per month combines per-use minutes × monthly frequency with separately entered additional monthly time. Missing additional time remains unknown; the life summary can show the known usage portion separately. Model-computed monthly totals cannot be added again as overhead.
- First payment is the cash needed for initial fixed charges and the first month's modeled usage. Recurring payment refers to monthly charges; annual renewals remain visible in cumulative spending.
- Missing values, incomplete cost lists, incompatible units and arithmetic errors cannot turn into zero-cost facts. A confirmed zero must be entered explicitly. Category ordering is supplied by the user, not inferred from words such as “quiet.”
- Common horizon, frequency and budget affect relevant alternatives. Editing a price affects that option and the resulting comparison. All edits calculate locally without calling the model.
- Charts, costs, constraints and the four-part life preview use the same current result. Qualitative assumptions are labeled and do not create automatic causal relationships.

The required fictional gym fixture uses CNY 1,200 annually versus CNY 150 monthly, equal unlimited service, and no other charges. At 4 months the monthly option costs CNY 600; at 8 months the options tie; during months 9–12 the annual option costs less. Renewal at month 13 starts another annual charge. Changing visits affects cost per use, not fixed total spending or its order.

## Materials and model actions

Each option can have zero, one or several pasted text materials. Explicit analysis returns quotes, multiple expression labels, disclosures, verification questions, and cross-material conflicts. It distinguishes no material, no obvious pressure, unresolved information and inconsistent materials. Materials do not produce a safety score or influence calculation just by their wording or count.

Proposed facts keep their source excerpt. Applying an extraction requires an explicit user action and displays an existing-value conflict. Suggestions cannot silently overwrite user factors. Replies bind to the request's decision ID and version so edits invalidate old analysis.

New APIs:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Local service and model-configuration availability, never secrets |
| `POST /api/choices/generate` | Structured decision, options, factors and a few clarifying questions |
| `POST /api/choices/factors` | New factor proposals for a current decision and an instruction |
| `POST /api/choices/materials` | Evidence-linked analysis of one option's materials |

The legacy `/api/scenarios/generate` and `/api/stories/generate` endpoints remain available. V2 life summaries are deterministic templates; optional model prose polishing is not implemented. See [the shared contract](docs/CLEAR_CHOICE_CONTRACT.md) for shapes, units and validation boundaries.

## Verification

```sh
cd frontend
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e

cd ../backend
export JAVA_HOME=$(/usr/libexec/java_home -v 21) # macOS only
./mvnw test
./mvnw -Pbundle-frontend package
```

Browser tests launch an isolated Vite instance on port 4173; no model credentials are required. Live evaluation is opt-in and uses only the backend, never direct key access:

```sh
python3 scripts/evaluate-model.py --live --base-url http://127.0.0.1:8081
# After a saved gym result, evaluate real materials and new-factor requests:
python3 scripts/evaluate-model.py --live --follow-ups
```

Evaluation fixtures cover a Chinese gym comparison, explicit housing hard constraints with unknown pet permission, and a generic course/defer decision. JSON reports and real responses go to `/tmp/clear-choice-model-eval`. Passing a limited sample is not a guarantee of model accuracy. [Verification notes](docs/VERIFICATION.md) distinguish checked behavior, fictional demos, model samples and remaining work.

## Current boundaries

The MVP supports pasted text materials and browser-local working state. Screenshot OCR, file parsing, URL crawling, account persistence, cross-device sharing and public deployment are not included. It does not discover products or verify merchants against outside evidence. Refunds, tax, income, loans, calendar-specific billing and uncertain causal effects require explicit additional facts and supported rules rather than generated formulas. Users should review suggested factors and completeness before relying on a comparison.
