#!/usr/bin/env node
// Explicit local API smoke checks. This file never reads model credentials.
import { readFile, mkdir, writeFile, realpath, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reviewCodes = new Set(["MISSING_VALUE", "UNCONFIRMED_ASSUMPTION"]);

export function sanitize(value) {
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
      .replace(/\b(?:nvapi-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /^(?:authorization|api[_-]?key|nvidia[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|credentials?)$/i.test(key)
        ? "[REDACTED]" : sanitize(item),
    ]));
  }
  return value;
}

async function saveJson(path, value) {
  await writeFile(path, `${JSON.stringify(sanitize(value), null, 2)}\n`, { mode: 0o600 });
}

export function parseArgs(args) {
  const options = { live: false, help: false, list: false, baseUrl: "http://127.0.0.1:8080", output: "/tmp/dayfork-case-checks", concurrency: 1, timeoutMs: 240000 };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--live") options.live = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--list") options.list = true;
    else if (["--base-url", "--output", "--cases", "--concurrency", "--timeout-ms"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--base-url") options.baseUrl = value;
      if (arg === "--output") options.output = resolve(value);
      if (arg === "--cases") options.caseIds = value.split(",").map((id) => id.trim()).filter(Boolean);
      if (arg === "--concurrency") options.concurrency = Number(value);
      if (arg === "--timeout-ms") options.timeoutMs = Number(value);
    } else throw new Error(`Unknown argument: ${arg}. Use --help.`);
  }
  const base = new URL(options.baseUrl);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
      || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("--base-url must be an HTTP localhost origin without credentials, a path, query, or fragment.");
  }
  options.baseUrl = base.origin;
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 2) {
    throw new Error("--concurrency must be 1 or 2.");
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 600000) {
    throw new Error("--timeout-ms must be an integer between 1000 and 600000.");
  }
  if (options.caseIds && (!options.caseIds.length || new Set(options.caseIds).size !== options.caseIds.length)) {
    throw new Error("--cases must contain unique, nonempty case IDs.");
  }
  return options;
}

function help(cases) {
  console.log(`Dayfork local scenario smoke checks

Usage:
  node scripts/verify-scenarios.mjs --help
  node scripts/verify-scenarios.mjs --list
  node scripts/verify-scenarios.mjs --live [options]

No HTTP requests are made unless --live is present. Start the configured local
backend separately. The harness never reads .env or contacts the model provider
directly, and it performs no retries. The backend retains its own retry policy.

Options:
  --cases ID,ID        Selected corpus cases (default: all)
  --base-url ORIGIN   Local HTTP origin (default: http://127.0.0.1:8080)
  --output DIRECTORY Artifact directory (default: /tmp/dayfork-case-checks)
  --concurrency N    Concurrent cases: 1 or 2 (default: 1)
  --timeout-ms N     Per-request timeout (default: 240000)

Artifacts: summary.json and CASE/{scenario,story}-{request,response}.json,
plus CASE/analysis.json. Files for selected cases are replaced on reruns; use a
new output directory to preserve a previous run. Artifact credential-like fields
and common bearer/API-key patterns are redacted; only synthetic corpus inputs
are sent. No credential environment variables are loaded or logged.

Every scenario uses the frontend schema, reference validator, and simulation
engine. Each Tag is tested alone, without supplying or confirming missing
numbers. A valid baseline matching the case expectations gets one General day
story request. Missing values produce needs_review and never become guessed
numbers. Expected needs_review cases and incomplete optional Tags are not
failures. Unexpected missing baseline values, invalid outputs, HTTP failures,
and mismatched supplied totals exit 1. Invocation/setup errors exit 2.

Story checks cover snapshot identity, paired moments, reflections, and fact
placeholders. Narrative claims still require a human review of the artifacts.

Cases:
${cases.map((item) => `  ${item.id}: ${item.name} (${item.expectedBaseline})`).join("\n")}`);
}

export async function loadDomain() {
  const frontendRequire = createRequire(resolve(projectRoot, "frontend/package.json"));
  const { build } = frontendRequire("esbuild");
  const bundled = await build({
    stdin: {
      contents: 'export { decisionSchema, validateDecision } from "./src/domain/schema"; export { simulate } from "./src/domain/simulate"; export { buildStoryFacts } from "./src/domain/story";',
      resolveDir: resolve(projectRoot, "frontend"),
      sourcefile: "scenario-smoke-entry.ts",
      loader: "ts",
    },
    bundle: true, write: false, platform: "node", format: "esm", target: "node22", logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
}

function numericFields(value, path = "") {
  if (!value || typeof value !== "object") return [];
  if (Object.hasOwn(value, "source") && Object.hasOwn(value, "value")) return [{ path, ...value }];
  return Object.entries(value).flatMap(([key, child]) => numericFields(child, path ? `${path}.${key}` : key));
}

function calculationStatus(result) {
  if (result.status === "valid") return "valid";
  return result.issues.every((issue) => reviewCodes.has(issue.code)) ? "needs_review" : "invalid";
}

function totalsSignature(options) {
  return options.map((option) => `${option.totalCostCents}:${option.totalTimeMinutes}`).sort().join("|");
}

export function analyzeDecision(payload, testCase, domain) {
  const parsed = domain.decisionSchema.safeParse(payload);
  if (!parsed.success) {
    return { status: "invalid", schema: "invalid", schemaIssues: parsed.error.issues, failures: ["Scenario does not match the frontend decision schema."] };
  }
  const decision = parsed.data;
  const structuralIssues = domain.validateDecision(decision);
  const failures = [];
  if (structuralIssues.length) failures.push("Scenario contains invalid IDs or references.");
  if (decision.tags.length < 5 || decision.tags.length > 10) failures.push("Scenario must include 5–10 suggested Tags.");
  const baselineFields = numericFields(decision.options, "options");
  const unknownBaseline = baselineFields.filter((field) => field.source === "unknown");
  const unconfirmedBaseline = baselineFields.filter((field) => field.source === "demo_assumption" && !field.confirmed);
  const assumptions = numericFields(decision).filter((field) => field.source === "demo_assumption");
  if (assumptions.length) failures.push("Model supplied example assumptions although no corpus case authorized assumptions.");
  const calculation = domain.simulate(decision, []);
  const baselineStatus = calculationStatus(calculation);
  const tags = decision.tags.map((tag) => {
    const result = domain.simulate(decision, [tag.id]);
    return { id: tag.id, name: tag.name, type: tag.type, status: calculationStatus(result), baselineBlocksCalculation: baselineStatus !== "valid", calculation: result };
  });
  if (baselineStatus === "invalid") failures.push("Baseline simulation is invalid.");
  if (baselineStatus !== testCase.expectedBaseline) failures.push(`Expected baseline ${testCase.expectedBaseline}, received ${baselineStatus}.`);
  if (testCase.expectedBaseline === "needs_review" && !unknownBaseline.length) failures.push("Vague input must retain unknown baseline values.");
  if (calculation.status === "valid" && testCase.expectedTotals
      && totalsSignature(calculation.options) !== totalsSignature(testCase.expectedTotals)) {
    failures.push("Calculated totals do not match the explicitly supplied case values (option order ignored).");
  }
  if (tags.some((tag) => tag.status === "invalid")) failures.push("At least one individually enabled Tag produces an invalid configuration.");
  return {
    status: failures.length ? (baselineStatus === "needs_review" ? "needs_review" : "invalid") : baselineStatus,
    schema: "valid", structuralIssues, failures, baselineStatus, unknownBaseline, unconfirmedBaseline,
    assumptions, calculation, tags, optionNames: decision.options.map((option) => option.name),
  };
}

export function validateStory(story, request) {
  const issues = [];
  const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
  if (!story || typeof story !== "object") return ["Story must be a JSON object."];
  if (story.decisionId !== request.snapshot.decision.id || story.simulationVersion !== request.snapshot.simulationVersion) {
    issues.push("Story does not match the requested simulation snapshot.");
  }
  if (!nonempty(story.sharedScenario?.title) || !nonempty(story.sharedScenario?.description)) issues.push("Story needs a shared scenario title and description.");
  const optionIds = request.snapshot.decision.options.map((option) => option.id).sort();
  const paired = (items) => Array.isArray(items) && items.length === 2
    && items.every((item) => item && nonempty(item.text))
    && JSON.stringify(items.map((item) => item.optionId).sort()) === JSON.stringify(optionIds);
  if (!Array.isArray(story.moments) || story.moments.length !== 3
      || ["morning", "daytime", "evening"].some((key) => story.moments.filter((moment) => moment?.key === key).length !== 1)
      || story.moments.some((moment) => !paired(moment?.options))) issues.push("Story needs exactly three matching moments, each containing both options.");
  if (!paired(story.monthlyReflections)) issues.push("Story needs one monthly reflection for each option.");
  const strings = JSON.stringify(story);
  for (const [, key] of strings.matchAll(/\{\{([^{}]+)\}\}/g)) {
    if (!Object.hasOwn(request.facts, key)) issues.push(`Unknown story fact placeholder: ${key}.`);
  }
  return [...new Set(issues)];
}

async function postJson(options, caseDir, stage, path, request) {
  await saveJson(resolve(caseDir, `${stage}-request.json`), request);
  const start = performance.now();
  let result;
  try {
    const response = await fetch(`${options.baseUrl}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      signal: AbortSignal.timeout(options.timeoutMs), redirect: "error",
    });
    const responseText = await response.text();
    let body;
    try { body = JSON.parse(responseText); } catch { body = null; }
    result = { httpStatus: response.status, ok: response.ok, elapsedMs: Math.round(performance.now() - start), body };
    if (body === null) result.parseError = "Response was not a non-null JSON value.";
    // Do not persist arbitrary HTML/proxy text from a failed local request.
  } catch (error) {
    result = { httpStatus: null, ok: false, elapsedMs: Math.round(performance.now() - start), transportError: error.name ?? "Error" };
  }
  await saveJson(resolve(caseDir, `${stage}-response.json`), result);
  return result;
}

async function runCase(testCase, options, domain) {
  const start = performance.now();
  const caseDir = resolve(options.output, testCase.id);
  await mkdir(caseDir, { recursive: true, mode: 0o700 });
  // Clear only files owned by this harness; skipped stages must not retain old results.
  for (const filename of ["scenario-request.json", "scenario-response.json", "story-request.json", "story-response.json", "analysis.json", "result.json"]) {
    await unlink(resolve(caseDir, filename)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  const result = { id: testCase.id, name: testCase.name, expectedBaseline: testCase.expectedBaseline, status: "invalid", failures: [], story: { status: "skipped", reason: "No valid baseline yet." } };
  const progress = (stage, extra = {}) => process.stderr.write(`${JSON.stringify({ case: testCase.id, stage, ...extra })}\n`);
  progress("scenario_started");
  try {
    const scenario = await postJson(options, caseDir, "scenario", "/api/scenarios/generate", { description: testCase.description });
    result.scenario = { httpStatus: scenario.httpStatus, elapsedMs: scenario.elapsedMs, transportError: scenario.transportError, parseError: scenario.parseError };
    progress("scenario_received", result.scenario);
    if (!scenario.ok || scenario.parseError) {
      result.status = "scenario_error";
      result.failures.push("Scenario request failed; inspect scenario-response.json.");
      result.scenario.error = scenario.body;
    } else {
      const analysis = analyzeDecision(scenario.body, testCase, domain);
      await saveJson(resolve(caseDir, "analysis.json"), analysis);
      Object.assign(result, {
        status: analysis.status, failures: analysis.failures, schema: analysis.schema,
        schemaIssues: analysis.schemaIssues, structuralIssues: analysis.structuralIssues,
        baselineStatus: analysis.baselineStatus, unknownBaseline: analysis.unknownBaseline,
        unconfirmedBaseline: analysis.unconfirmedBaseline, optionNames: analysis.optionNames,
        calculation: analysis.calculation,
        tags: analysis.tags?.map(({ id, name, type, status, calculation }) => ({ id, name, type, status, issues: calculation.issues })),
      });
      if (analysis.baselineStatus === "valid" && !analysis.failures.length) {
        const decision = domain.decisionSchema.parse(scenario.body);
        const request = {
          snapshot: { decision, enabledTagIds: [], simulationVersion: 1, calculation: analysis.calculation },
          context: { mode: "general" }, facts: domain.buildStoryFacts(decision, analysis.calculation),
        };
        progress("story_started");
        const story = await postJson(options, caseDir, "story", "/api/stories/generate", request);
        const issues = story.ok && !story.parseError ? validateStory(story.body, request) : ["Story request failed; inspect story-response.json."];
        result.story = { status: issues.length ? "invalid" : "valid", httpStatus: story.httpStatus, elapsedMs: story.elapsedMs, issues, transportError: story.transportError, parseError: story.parseError };
        if (issues.length) {
          result.status = "story_error";
          result.failures.push(...issues);
        } else result.status = "passed";
      } else result.story.reason = analysis.baselineStatus === "needs_review" ? "Missing or unconfirmed baseline values; no numbers were supplied by the harness." : "Scenario validation or expectation failed.";
    }
  } catch (error) {
    result.status = "harness_error";
    result.failures.push(sanitize(error.message));
  }
  result.elapsedMs = Math.round(performance.now() - start);
  result.passed = result.failures.length === 0;
  await saveJson(resolve(caseDir, "result.json"), result);
  progress("complete", { status: result.status, passed: result.passed, elapsedMs: result.elapsedMs });
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const allCases = JSON.parse(await readFile(resolve(projectRoot, "scripts/scenario-cases.json"), "utf8"));
  if (options.help || (!options.live && !options.list)) { help(allCases); return 0; }
  if (options.list) {
    console.log(JSON.stringify(allCases.map(({ id, name, expectedBaseline }) => ({ id, name, expectedBaseline })), null, 2));
    return 0;
  }
  const cases = options.caseIds ? options.caseIds.map((id) => {
    const item = allCases.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Unknown case: ${id}. Use --list.`);
    return item;
  }) : allCases;
  const domain = await loadDomain();
  await mkdir(options.output, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const results = new Array(cases.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(options.concurrency, cases.length) }, async () => {
    while (cursor < cases.length) {
      const index = cursor++;
      results[index] = await runCase(cases[index], options, domain);
    }
  }));
  const summary = {
    startedAt, finishedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start),
    baseUrl: options.baseUrl, output: options.output, concurrency: options.concurrency,
    caseCount: results.length, passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    needsReview: results.filter((result) => result.baselineStatus === "needs_review").length,
    narrativeReview: "Structural checks do not establish that every narrative claim is supported; review story artifacts manually.",
    results,
  };
  await saveJson(resolve(options.output, "summary.json"), summary);
  console.log(JSON.stringify({
    caseCount: summary.caseCount, passed: summary.passed, failed: summary.failed,
    needsReview: summary.needsReview, elapsedMs: summary.elapsedMs,
    summaryPath: resolve(options.output, "summary.json"),
    results: results.map(({ id, status, passed, scenario, story, failures }) => ({
      id, status, passed, scenarioHttp: scenario?.httpStatus, storyHttp: story?.httpStatus, failures,
    })),
  }, null, 2));
  return summary.failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === await realpath(process.argv[1]).catch(() => "")) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(JSON.stringify({ status: "harness_error", message: sanitize(error.message) }));
    process.exitCode = 2;
  });
}
