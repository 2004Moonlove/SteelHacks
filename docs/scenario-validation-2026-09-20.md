# Scenario contract validation — 2026-09-20

Repeated `The story request is invalid` errors included an application contract bug: the frontend sent comparison facts that the backend rejected. Model-generated scenarios also sometimes used unsupported fields, and model-generated story metadata could drift from the request. Stronger prompt wording alone cannot enforce these boundaries.

The implementation now generates the scenario prompt schema from the frontend validator, validates it independently on the backend, and permits one bounded repair. Code binds story IDs, versions, option ordering, and monthly summaries to the validated simulation; the model supplies narrative text for fixed morning/daytime/evening slots. The public API and deterministic simulation engine are unchanged.

## Cases exercised

The corpus is in `scripts/scenario-cases.json`. Figures below are calculated by the actual frontend engine, using successful live model outputs; they are not model-calculated totals.

| Case | Baseline result | Live story coverage |
| --- | --- | --- |
| Gym membership versus pay per visit, explicit prices and use | $60 / $96 per month; 720 / 720 minutes | General day |
| Same gym question, no prices or use | Review required; missing numeric values remain unknown | Not requested while baseline is incomplete |
| Annual versus monthly gym plan, no prices | Review required; missing membership prices remain unknown | Not requested while baseline is incomplete |
| Company relocation abroad versus staying local, no budget | Review required; missing costs and usage remain unknown | Not requested while baseline is incomplete |
| Local versus abroad, supplied recurring USD budget | $2,240 / $1,940 per month; 1,000 / 600 commute minutes | General day |
| Cooking versus delivered dinners | $100 / $240 per month; 600 / 100 active minutes | General day |
| Near-campus versus farther-away housing | $1,500 / $1,100 per month; 400 / 1,600 commute minutes | General day; separate Campus day fixture with an enabled Uber replacement |

Every successful scenario was checked against the frontend schema and reference validator. Each Tag was enabled individually; unspecified Tag parameters can legitimately require review. Known-value cases were compared with independently specified expected totals. Stories were checked for the requested identity, paired moments, reflections, and known fact references.

## Failures found and changes

- Unsupported `option.description` caused a gym scenario to fail even after repair. The prompt now includes the schema generated from code, with strict option fields and shared structural limits.
- Valid long option names exceeded the previous story-fact length limit. Exact facts containing supported names now pass; altered facts still fail.
- Floating-point formatting lost one cent at the safe-integer boundary. Shared integer-cent formatting now matches Java exactly.
- Quantity-free questions sometimes received invented known Tag counts. A negative-evidence guard clears otherwise-valid known values to `unknown` when the input contains no possible quantity or free/no-fee cue. It preserves explicit quantities, including “an hour,” and does not conceal malformed fields. This is not complete numeric provenance verification.
- Full story generation made IDs, ordering, and versions unnecessarily model-dependent. Code now owns these fields, while invalid legacy metadata still fails validation.
- Narrative review found repeated gym sessions and full comparison sentences incorrectly embedded as monetary amounts. The model receives a compact routine/fact projection; prompts limit repeated activities, and code now constructs the monthly summaries directly from canonical facts.
- Provider requests sometimes returned temporary service errors or timed out after 60 seconds. The configured Nemotron model now uses its documented low-effort controls; a successful full gym request took about 13 seconds afterward, but later availability is not guaranteed. Truncated completions are reported distinctly.

Relocation remains a recurring-cost and routine comparison. It excludes unsupported upfront-cost amortization and broad career, immigration, tax, or life-outcome predictions. Vague relocation output still suggested some unrequested activity categories, and generated Tag labels can include suggested quantities even when editable numeric fields are unknown. Baseline and Tag review remain necessary; structural validity is not proof of narrative or suggestion quality.

## Verification and reproduction

Offline acceptance: 41 frontend tests, 112 backend tests, production frontend build, and bundled Spring Boot package passed. Coverage includes the original campus calculations, Tag arithmetic, General/Campus request fixtures, malformed requests, legacy story compatibility, bounded repair, and provider error handling.

Run without credentials or network calls:

```sh
npm --prefix frontend test
npm --prefix frontend run build
cd backend
./mvnw -Pbundle-frontend package
```

With the configured localhost backend already running:

```sh
node scripts/verify-scenarios.mjs --live --concurrency 1 --output /tmp/dayfork-case-checks
```

The suite makes no requests without `--live`, never reads `.env`, and keeps detailed artifacts outside the repository. Reusing a case directory replaces only its known generated artifact files. Live results varied across attempts: all seven case inputs produced successful scenario responses across the recorded runs, but the initial seven-case run contained five provider timeouts, and an intermediate relocation story failed model-output validation. Those failures are retained in the local artifacts rather than represented as an all-pass single run. After the final assembly change, four separate story requests (gym, relocation, dinners, and Campus day) all returned HTTP 200 with the expected deterministic monthly summaries. Final Campus text used the selected clock/mode facts and dinner appeared in the evening. The gym narrative still placed the equivalent visits at different illustrative moments, so semantic alignment remains a model-quality limitation despite matching slot keys.

The model-specific controls follow the [NVIDIA API reference](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer). JSON Schema is supplied as prompt guidance; provider-enforced constrained decoding is not claimed.

Local diagnostic runs are retained in `/tmp/dayfork-case-checks-20260920`, `/tmp/dayfork-case-checks-low`, `/tmp/dayfork-case-checks-guard`, and `/tmp/dayfork-final-assembly-checks`. These temporary artifacts are not committed or guaranteed to persist.
