# Nemotron integration evidence

The selected deployment remains `nvidia/nemotron-3-super-120b-a12b` through `https://integrate.api.nvidia.com/v1/chat/completions`.

Official references checked for this implementation:

- [NVIDIA model card](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard): multilingual support includes Chinese. A model-card capability is not evidence that every Chinese decision has been evaluated.
- [NVIDIA inference API reference](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer): the chat endpoint supports the selected model and `reasoning_effort` values `none`, `low` and `high`.

The reviewed inference schema does not explicitly document `response_format`/`json_schema` for this endpoint. The application therefore uses JSON instructions, a strict server validator, frontend schema validation and at most one semantic repair. It does not claim server-enforced JSON Schema decoding or perfectly accurate semantic extraction. Model outputs are untrusted proposals; exact quotations can establish provenance but do not prove the interpretation is true.

The client accepts optional `NVIDIA_REASONING_EFFORT` (`none`, `low`, `high`); omitting it retains the existing provider default. It retains server-only credentials, timeouts and bounded recovery for fast transient HTTP errors. Explicit model actions are initial understanding, new factor suggestions and per-option material analysis. Local parameter edits, calculations, charts and v2 life summaries do not call the model.

The real-evaluation results, including timeouts or failed outputs, are recorded separately in [VERIFICATION.md](VERIFICATION.md). See `scripts/evaluate-model.py` for reproducible opt-in input fixtures; the supplied case texts contain only fictional data.
