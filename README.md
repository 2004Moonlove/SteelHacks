# Dayfork

Dayfork helps compare two spending choices through editable monthly costs and time. A model can turn a written decision into two options and suggested Tags. A deterministic browser-side engine calculates the tradeoff, and a second, explicit model request can turn a valid snapshot into parallel stories. The product does not recommend a winner.

## Requirements

- Node.js 24 and npm
- Java 21
- A local NVIDIA API key and an accessible Nemotron model ID for live model requests

The complete campus housing demo, calculation engine, and labeled offline story preview work without model credentials.

## Run in development

Use separate terminals:

```sh
cd frontend
npm ci
npm run dev
```

```sh
cd backend
./mvnw spring-boot:run
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` to the backend at `127.0.0.1:8080`.

The macOS workspace has Java 17 as its default. Select Java 21 before starting Maven, for example:

```sh
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
```

## Configure Nemotron

Set these variables in the backend process environment before starting it:

```sh
export NVIDIA_API_KEY="your-local-key"
export NVIDIA_MODEL="your-accessible-model-id"
```

Optional variables are `NVIDIA_API_URL` (default: `https://integrate.api.nvidia.com/v1/chat/completions`) and `NVIDIA_TIMEOUT_SECONDS` (default: `60`). See [.env.example](.env.example) for names. Spring Boot does not automatically load that example file. Never commit a real key or put it in a `VITE_*` variable.

Without both required variables, **Try Demo** remains available. Live generation reports that model configuration is unavailable and does not silently replace the requested result with a fixture.

## Test and package

```sh
cd frontend
npm ci
npm test
npm run build
```

```sh
cd backend
./mvnw test
./mvnw -Pbundle-frontend package
java -jar target/dayfork-0.1.0.jar
```

Build the frontend before running the `bundle-frontend` Maven profile. Open <http://127.0.0.1:8080> for the single-address local demo. The server binds to localhost.

## Demo path

1. Choose **Try the campus housing demo** to load the labeled fixture, or describe a decision and choose **Explore this decision** when Nemotron is configured.
2. Review the baseline. Fill unknown values and explicitly confirm any demo assumptions.
3. Open the dashboard, enable **Take an Uber after class**, and change its monthly trip count from 6 to 10. Far's result changes from `$1,250 / 1,480 min` to `$1,350 / 1,400 min`; Near stays at `$1,500 / 400 min`.
4. Expand the breakdown to see original and replacement commute events.
5. Generate aligned parallel stories. If a parameter changes afterward, the story is marked stale until **Update Story** is selected.

The preview is explicitly labeled when it uses fixture text rather than a model response.

## API overview

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Service status and whether model configuration is present; no credential values |
| `POST /api/scenarios/generate` | Turn a decision description into a validated two-option `Decision` |
| `POST /api/stories/generate` | Generate a structured story from an immutable, valid simulation snapshot and fact inventory |

The calculation engine runs in the browser and does not call these endpoints when Tags or parameters change. Money is represented as integer cents, time as integer minutes, and activity frequency as integer events per month. Unknown values remain unknown rather than becoming zero. The full data contract and acceptance fixture are recorded in [MEMORY.md](MEMORY.md).

## Contract and scenario checks

The frontend validator defines the machine-readable scenario format. Generate the backend's prompt schema after changing that validator:

```sh
node scripts/generate-contract.mjs
npm --prefix frontend test
```

A regression test verifies that the checked-in schema matches the current validator. The schema guides model generation; strict backend validation, reference checks, and one bounded repair still apply. The model writes story text into fixed option slots, while code inserts decision IDs, simulation versions, option IDs, moment ordering, and monthly summaries from validated facts. The public story API is unchanged. Money and time calculations stay in the deterministic engine. A conservative guard keeps values unknown when the input contains no numeric evidence; it is not a general proof that every model-supplied number is grounded.

For `nvidia/nemotron-3-super-120b-a12b`, the client uses low-effort reasoning with a 1,024-token reasoning budget, following the [model API controls](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer). The change was verified against the same full gym case that exceeded the default 60-second timeout. Provider timeouts still occurred during testing; this is not an availability guarantee. Other models retain their existing request parameters. Truncated completions return a specific error and do not enter semantic repair.

With the configured local backend running, explicitly run the synthetic live case suite:

```sh
node scripts/verify-scenarios.mjs --live --concurrency 2 --output /tmp/dayfork-case-checks
```

Use `--list` to inspect the cases, or `--cases gym-specified,relocation-specified` to select cases. Running without `--live` makes no requests. The harness checks the real frontend schema, references, calculated totals, individual Tags, story identity, and fact placeholders; it saves a detailed `summary.json` and per-case artifacts locally. Missing prices or usage remain unknown and require review. Narrative meaning still needs human review. See the [recorded case results and limitations](docs/scenario-validation-2026-09-20.md).

Relocation examples compare supplied recurring USD expenses and routine time. They do not model a complete career or immigration decision, or silently amortize upfront relocation costs.

## Current limits

- Decisions must fit two options, monthly cost/time values, and the four built-in Tag rules: fixed, add activity, reduce activity, and replace activity.
- The campus timeline depicts one illustrative day; monthly totals use the full configuration.
- The MVP saves no account or cross-device state. Browser-local persistence and custom Tags are future work.
- Live model verification requires the configured credentials and model access. Mocked backend tests and the labeled offline demo cover the credential-free path.
