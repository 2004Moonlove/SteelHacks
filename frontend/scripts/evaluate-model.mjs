import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.CHOICE_API_BASE || "http://127.0.0.1:8080";
const output = new URL(
  "../../artifacts/model-evaluation.json",
  import.meta.url,
);
const cases = [
  {
    id: "buy-or-wait",
    text: "Should I buy a laptop or wait? My budget is 900 USD. I need it for class. I have not chosen a model.",
    hard: true,
  },
  {
    id: "repair",
    text: "Should I repair my old computer for 200 USD or buy a new one for 900 USD? I plan to use it for 24 months.",
    hard: false,
  },
  {
    id: "housing-cat-zh",
    text: "两套房选哪套？我必须能带猫，单程通勤必须不超过30分钟。房租和宠物政策还不知道。",
    hard: true,
  },
  {
    id: "membership-zh",
    text: "健身房年卡1200元、月卡150元，服务相同，无其他费用，两种都不限次数。我用4个月，每周去3次，哪个支出更低？",
    hard: false,
  },
  {
    id: "weekend-job",
    text: "Should I take a weekend job or keep my weekends free? I must be free on Sundays. Pay and travel time are unknown.",
    hard: true,
  },
  {
    id: "courses",
    text: "Choose between a design course and a coding course. I care about interest and schedule flexibility. No prices are known.",
    hard: false,
  },
  {
    id: "open-domain",
    text: "Should I volunteer at an observatory or join a local theater group? I need a way to leave after one month.",
    hard: true,
  },
];
const report = {
  generatedAt: new Date().toISOString(),
  mode: "live-model-evaluation",
  status: "pending",
  cases: [],
  limitation:
    "Automated contract checks do not establish full semantic accuracy. Review returned goals, options, constraints, quotes and suggestions manually.",
};
const save = () => {
  mkdirSync(new URL("../../artifacts/", import.meta.url), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
};
try {
  const health = await fetch(`${base}/api/health`, {
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json());
  if (!health.modelConfigured) {
    report.status =
      "blocked: NVIDIA_API_KEY and NVIDIA_MODEL are not configured";
    save();
    console.log(report.status);
    process.exitCode = 2;
  } else {
    for (const c of cases) {
      const start = Date.now();
      try {
        const response = await fetch(`${base}/api/choices/understand`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: c.text }),
          signal: AbortSignal.timeout(135000),
        });
        const data = await response.json();
        const checks = {
          validResponse: response.ok,
          liveOrigin: data.origin === "model",
          options: data.options?.length >= 2,
          explicitRequirement:
            !c.hard ||
            data.factors?.some((f) => f.purpose === "hard") ||
            data.context?.budgetCents != null,
          reviewRequired: data.factors?.every((f) => !f.confirmed),
          noInventedMaterials: data.options?.every(
            (o) => o.materials.length === 0,
          ),
        };
        report.cases.push({
          id: c.id,
          milliseconds: Date.now() - start,
          checks,
          passed: Object.values(checks).every(Boolean),
          response: data,
        });
      } catch (e) {
        report.cases.push({ id: c.id, passed: false, error: String(e) });
      }
      save();
      console.log(
        `${c.id}: ${report.cases.at(-1).passed ? "contract checks passed; semantic review required" : "failed"}`,
      );
    }
    report.status = report.cases.every((c) => c.passed)
      ? "contract checks passed; semantic review pending"
      : "failed";
    save();
    if (report.cases.some((c) => !c.passed)) process.exitCode = 1;
  }
} catch {
  report.status = "blocked: local backend is unavailable";
  save();
  console.log(report.status);
  process.exitCode = 2;
}
