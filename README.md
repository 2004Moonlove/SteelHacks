# Dayfork

Dayfork helps explore two paths for a medium- or long-term decision. Select the factors that matter, then generate two corresponding storylines. Recurring costs support editable monthly calculations; purchase-versus-use decisions support cumulative costs and a use-count break-even point; annual/monthly memberships compare whole prepaid billing periods over an editable window. Qualitative decisions go directly to factors and stories without numerical forms or charts. The product does not recommend a winner.

## Requirements

- Node.js 24 and npm
- Java 21
- A local NVIDIA API key and an accessible Nemotron model ID for live model requests

The annual/monthly membership, campus housing, gaming-versus-office-laptop, and coffee-machine demos, plus labeled offline story previews work without model credentials.

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
runtime_jar="$(mktemp /tmp/dayfork-runtime.XXXXXX)"
cp target/dayfork-0.1.0.jar "$runtime_jar"
java -jar "$runtime_jar"
```

Build the frontend before running the `bundle-frontend` Maven profile. Open <http://127.0.0.1:8080> for the single-address local demo. The server binds to localhost. Launching a separate runtime copy keeps later builds from replacing a running JAR.

## Demo path

1. Choose **Campus housing** to load the labeled fixture, or describe a decision and choose **Explore this decision** when Nemotron is configured.
2. Review the baseline. Fill unknown values and explicitly confirm any demo assumptions.
3. Open the dashboard, enable **Take an Uber after class**, and change its monthly trip count from 6 to 10. Far's result changes from `$1,250 / 1,480 min` to `$1,350 / 1,400 min`; Near stays at `$1,500 / 400 min`.
4. Expand the breakdown to see original and replacement commute events.
5. Generate aligned parallel stories. If a parameter changes afterward, the story is marked stale until **Update Story** is selected.

The preview is explicitly labeled when it uses fixture text rather than a model response.

## Qualitative decision path

Choose **Gaming vs. office laptop**, or enter a decision such as “Should I buy a gaming laptop or an office laptop?” with the model configured. The qualitative path opens factor selection directly. Select concerns such as gaming, working away from home, or work/leisure boundaries, then choose **Generate Stories**. Both paths use corresponding Beginning, During, and Later stages. Stories describe possible lived situations, followed by practical advice for each path; an interactive two-path journey links the corresponding stages. There are no forced cost/time inputs, comparison charts, or monthly summaries.

Factors describe possibilities to explore, not verified product specifications or guaranteed outcomes. A qualitative factor in an otherwise quantitative decision affects the story context without changing any totals. Toggling a factor never calls the model; it marks an existing story stale until explicitly updated.

Tag counts follow the relevant concerns in each scenario, without global fixed quantity bands or a global minimum quota. The technical maximum is thirty. Typical broad campus housing comparisons aim for eight to ten distinct factors, mixing numerical adjustments with qualitative living concerns. Up to ten factors are visible without expansion; larger sets can be expanded. Optional importance sliders express personal priorities for story emphasis. They do not change calculated costs or time, and remain unset until edited.

## Purchase versus per-use comparison

Choose **Coffee machine vs. buying coffee** for a labeled example, or describe buying a coffee machine versus buying coffee at Starbucks. Enter upfront and per-cup costs; missing prices remain blank. The cost chart compares the same cup count for both options. In the example, a $300 machine with $1 per cup reaches the $6-per-cup alternative at 60 cups. This is a use-count comparison, not a promised payback date.

Edit prices or the chart range locally, select factors and optional importance levels, then generate paired longer-term stories. Cost facts are calculated in code and independently reconciled by the backend. The model supplies narrative text, not arithmetic or assumed current prices.

## Annual versus monthly membership

Choose **Annual vs. monthly membership**, or enter `year card or month card`. Each option has a price per billing period, rather than a per-event cost or duration. The comparison window defaults visibly to twelve months and can be edited from one to 120 months without calling the model.

Payments are charged in full at the start of each required period. With example prices of $600 annually and $60 monthly, totals over six months are $600 versus $360; over twelve months, $600 versus $720; and over thirteen months, $1,200 versus $780 because the annual plan renews. A step chart shows the payment pattern. Unused coverage is not assumed refundable, and cancellation fees, price changes and pause rules are not calculated.

Select relevant factors such as schedule changes, a steady routine or upfront affordability. Stories depict conditional experiences under those choices and give practical suggestions for each path. Narrative details and advice do not silently add amounts or activities to the calculation.

The current **Campus housing** demo offers nine factors: six numerical adjustments and three personal considerations with importance sliders. The legacy monthly arithmetic fixture remains unchanged for regression checks.

## API overview

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Service status and whether model configuration is present; no credential values |
| `POST /api/scenarios/generate` | Turn a decision description into a validated two-option `Decision` with explicit v2 comparison mode |
| `POST /api/stories/generate` | Generate a structured story from an immutable monthly, per-use, subscription, or qualitative snapshot and validated fact inventory |

The calculation engine runs in the browser and does not call these endpoints when Tags or parameters change. Money is represented as integer cents, time as integer minutes, and activity frequency as integer events per month. Unknown values remain unknown rather than becoming zero. The full data contract and acceptance fixture are recorded in [MEMORY.md](MEMORY.md).

## Contract and scenario checks

The frontend validator defines the machine-readable scenario format. Generate the backend's prompt schema after changing that validator:

```sh
node scripts/generate-contract.mjs
npm --prefix frontend test
node --test scripts/verify-scenarios.test.mjs
```

A regression test verifies that the checked-in schema matches the current validator. The schema guides model generation; strict backend validation, reference checks, and one bounded repair still apply. The model writes story text into fixed option slots, while code inserts decision IDs, simulation versions, option IDs, moment ordering, and monthly summaries from validated facts. Quantitative story responses keep their existing shape. Qualitative responses have `mode: "qualitative"`, paired `beginning`/`during`/`later` moments, and an empty `monthlyReflections` array. Money and time calculations stay in the deterministic engine. A conservative guard keeps values unknown when the input contains no numeric evidence; it is not a general proof that every model-supplied number is grounded.

For `nvidia/nemotron-3-super-120b-a12b`, the client uses low-effort reasoning with a 1,024-token reasoning budget, following the [model API controls](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer). The change was verified against the same full gym case that exceeded the default 60-second timeout. Provider timeouts still occurred during testing; this is not an availability guarantee. Other models retain their existing request parameters. Truncated completions return a specific error and do not enter semantic repair.

With the configured local backend running, explicitly run the synthetic live case suite:

```sh
node scripts/verify-scenarios.mjs --live --concurrency 2 --output /tmp/dayfork-case-checks
```

Use `--list` to inspect the cases, or `--cases gym-specified,relocation-specified` to select cases. Running without `--live` makes no requests. The harness checks the real frontend schema, references, calculated totals, individual Tags, story identity, and fact placeholders; it saves a detailed `summary.json` and per-case artifacts locally. Missing prices or usage remain unknown and require review. Narrative meaning still needs human review. See the [recorded case results and limitations](docs/scenario-validation-2026-09-20.md).

Broad relocation, career, purchase, and investment decisions can use qualitative factors and storylines. Explicit recurring-budget relocation comparisons still use the monthly engine. The application does not silently amortize upfront costs, invent investment returns, or predict career outcomes.

## Current limits

- Decisions compare exactly two options. Qualitative comparisons are not restricted to a domain list.
- Numerical calculations support monthly activities, upfront-plus-per-use costs, and whole-period subscription payments. Arbitrary cashflow schedules, contract refunds/penalties, and investment growth are not implemented. Those decisions use the qualitative path when their central tradeoff cannot be represented by these calculators.
- Missing numerical inputs in an otherwise calculable scenario still require price or baseline review; they are not silently converted into a qualitative result.
- The campus timeline depicts one illustrative day; monthly totals use the full configuration.
- The MVP saves no account or cross-device state. Browser-local persistence and custom Tags are future work.
- Live model verification requires the configured credentials and model access. Mocked backend tests and the labeled offline demo cover the credential-free path.

Qualitative-flow acceptance, live recovery observations, and remaining numerical limits are recorded in [the qualitative validation report](docs/qualitative-validation-2026-09-20.md).

Per-use cost comparisons, importance sliders and actual QQQ/coffee verification are recorded in [the follow-up validation report](docs/break-even-validation-2026-09-20.md).

Membership payments, mixed campus factors and experience-based stories are covered in [the membership and stories validation report](docs/membership-stories-validation-2026-09-20.md).
