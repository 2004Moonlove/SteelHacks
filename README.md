# Clear Choice

Clear Choice helps people understand an everyday decision, compare confirmed requirements and tradeoffs, and preview its effects on money, time and plans. Ordinary decisions work without advertising or sales material.

The new workspace is the default application. The original Dayfork application, calculation engine, APIs and tests remain available at `/#legacy`. Development is on `Yang`, tracking `origin/Yang`; `main` is preserved.

## Run locally

Requirements: Node.js 24+, npm, Java 21, and Chrome for the default browser test configuration. The repository includes a Maven wrapper. No database or account is needed.

```sh
cd frontend
npm ci
npm run dev
```

In another terminal:

```sh
cd backend
./mvnw spring-boot:run
```

On Windows use `mvnw.cmd` and ensure `JAVA_HOME` points to Java 21. This machine has a compatible runtime at `C:/Program Files/JetBrains/DataGrip 2024.3.3/jbr`. The system-default Java 11 is too old.

Open [the local workspace](http://127.0.0.1:5173). Vite proxies `/api` to Spring Boot at `127.0.0.1:8080`. Both services bind to localhost.

To package one local application:

```sh
cd frontend
npm run build
cd ../backend
./mvnw -Pbundle-frontend package
java -jar target/dayfork-0.1.0.jar
```

Then open [the packaged application](http://127.0.0.1:8080).

## Model configuration

Set these **backend environment variables**, without putting a key in the frontend, logs, Git, or chat:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NVIDIA_API_KEY` | For live calls | Your current NVIDIA API credential |
| `NVIDIA_MODEL` | For live calls | An accessible Nemotron model ID |
| `NVIDIA_API_URL` | No | Defaults to `https://integrate.api.nvidia.com/v1/chat/completions` |
| `NVIDIA_TIMEOUT_SECONDS` | No | Read timeout per request, default 60 seconds |
| `NVIDIA_JSON_MODE` | No | Default `true`; sends `response_format: {type: "json_object"}`. Set `false` only if the selected endpoint does not support this parameter. Application schema validation always applies. |

`.env.example` documents names; Spring Boot does not load it automatically. The health endpoint exposes configuration availability, never the key. No model response is replaced by a demo fixture. Model calls happen only on explicit understanding, suggestion, or material-analysis actions. Parameter edits, charts, comparisons and summaries make no model calls.

[NVIDIA's Nemotron 3 Super model card](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard) lists Chinese and English support. `nvidia/nemotron-3-super-120b-a12b` is a documented candidate; account access, endpoint behavior and task quality still need a live check. JSON mode is not schema conformance: both the browser and server validate every response, including option references, source quotes and current version. The backend allows one repair for invalid output and does not automatically retry upstream errors or rate limits.

## Try the application

- **Help me choose**: describe any everyday decision, then request Nemotron interpretation. Review proposed factors before they participate. Use the manual path when no model is configured.
- **Fictional examples**: memberships, housing with a cat, and courses. They demonstrate calculations and editing, not live understanding or live material analysis.
- **Factors & options**: rename or add alternatives (2–6), edit typed values and sources, set hard requirements, pick one primary preference, or add/remove custom factors. Additional natural-language requirements produce proposals; they do not replace user factors. Exact normalized names and overlapping calculation rules are deduplicated. Semantic synonyms still need review.
- **Compare & picture life**: see constraints, costs, time, scaled charts, current effects and instant summaries. Unknown values stay unknown; a comparison may tie, need information, or have no feasible option.
- **Supporting materials**: each option owns 0–8 text materials. Analyze that option's materials together. Findings have multiple tags and exact quotes. Extracted values require explicit confirmation; a conflicting price never changes automatically. Analysis is marked stale after edits.
- **Help me understand this**: attach pasted text to a new editable offer comparison, analyze its supporting materials, and add alternatives/requirements.

The current decision is saved in this browser's local storage. No cross-device storage is used. A one-step Undo reverses the latest edit. Invalid drafts stay on screen but are not written over the last valid saved decision; browser refresh restores that last valid version. Material text is saved with the decision; analysis findings stay in memory for the workspace session.

## Calculation contract

Money is integer cents, rule-based time is minutes, and unknown is `null`. Comparison horizons are whole months (1–120). Average monthly use is `usesPerWeek * 52 / 12`; this is a user assumption, not predicted attendance. Calculated money is rounded once per total to cents; per-use results are rounded to cents for display. Unspecified cost components are outside the model, so include unknown fee factors when costs might apply.

For `m` months:

```text
total = upfront + ceil(m / billing_months) * recurring
      + m * usesPerWeek * 52 / 12 * per_use
monthly minutes = time_monthly + usesPerWeek * 52 / 12 * time_per_use
```

The initial cash metric includes the first month's scheduled payment and modeled usage. Annual payments are charged in full, with renewal at each billing interval; they are not amortized. Deposits are included as initial cash outflows and no refund is assumed. Cost preferences attached to upfront/recurring/per-use inputs compare total horizon cost for lower/higher ordering. Explicit target preferences compare the specified factor's own target. Hard constraints always test their own factor values first. Costs in different currencies or rules using incompatible units are rejected; changing the currency label does not perform foreign exchange conversion.

Only confirmed rules contribute. Unknown/unconfirmed required inputs make dependent metrics unavailable. Invalid rules, duplicate rules, invalid dates, invalid references and unsafe arithmetic never produce current totals. Reference-only factors do not determine the preferred option. Categories use only user-supplied ordering; there are no weighted scores or invented qualitative measurements. Date hard conditions support exact/on-or-before/on-or-after ISO dates.

The fictional membership check is 1,200 CNY annually versus 150 CNY monthly, identical unlimited service and no other fees: 4 months → 1,200/600; 8 → 1,200/1,200; 9 → 1,200/1,350. Changing visits changes per-use costs, not fixed-payment ranking. With renewal, month 13 costs 2,400/1,950. Breakpoints shown are within the selected horizon and do not override hard requirements.

## Verification

```sh
cd frontend
npm test
npm run schema:check
npm run build
npm run test:e2e
npm run eval:model
cd ../backend
./mvnw test
./mvnw -Pbundle-frontend package
```

Browser tests use local Chrome. To use bundled Chromium instead, install it with `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=chromium`. `npm run schema:export` regenerates the backend JSON Schemas from Zod after contract changes. Java applies those schemas using [NetworkNT](https://github.com/networknt/json-schema-validator/tree/1.5.9), then validates semantic references and sources.

`eval:model` calls the real local backend with seven English/Chinese evaluation cases. It records an explicit blocked result when configuration is absent and never treats mocked output as a live evaluation. Results and browser screenshots go to ignored `artifacts/`; traces go to ignored `frontend/test-results/`.

See [acceptance evidence](docs/ACCEPTANCE.md) for actual results, mock/live distinctions, and remaining limitations.

## APIs

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Service and configuration availability |
| `POST /api/choices/understand` | `{description}` → validated v2 decision, proposed factors, ≤3 questions |
| `POST /api/choices/factors` | `{decision,instruction}` → versioned factor proposals |
| `POST /api/choices/materials` | `{decision,optionId}` → versioned findings and extracted-value proposals |
| `POST /api/scenarios/generate` | Preserved Dayfork v1 scenario generation |
| `POST /api/stories/generate` | Preserved Dayfork v1 model stories |

## Scope limits

Live Nemotron quality is unverified on this machine until credentials/model access are configured. Structured and evidence validation cannot prove that a model has understood every requirement or the real-world truth of a quoted claim. Manual review remains part of the flow. Clear Choice summaries are deterministic templates, not model-polished stories.

Material input is pasted text. OCR, file parsing, URL collection, public deployment, arbitrary formulas, exchange rates, partial-month billing, actual calendar scheduling, automatic refunds, speculative causal predictions and composite utility scoring are not implemented. All declared time and cost components are additive; describe one common use unit per decision or use fixed monthly time for unrelated activities. Hard constraints and qualitative factors still support open-domain comparisons outside the built-in cost examples.
