import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Compass,
  FileSearch,
  GitCompareArrows,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Badge, Button, Card, Input } from "../components/ui";
import { Factors, selectClass } from "./FactorEditor";
import { Materials } from "./Materials";
import { CompletionGuide } from "./CompletionGuide";
import { getCompletionNeeds } from "./completion";
import { Charts, colors } from "./Charts";
import { blankDecision, demoDecision, makeFactor } from "./fixtures";
import { compare, impact, lifeSummary, money, type Comparison } from "./engine";
import { mergeSuggestions, suggest, understand } from "./api";
import {
  decisionSchema,
  type ChoiceDecision,
  type MaterialAnalysis,
  uid,
  unknownValue,
  userSource,
} from "./schema";

const storageKey = "clear-choice-v2";
function restore() {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? decisionSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function Home({
  saved,
  onOpen,
}: {
  saved: ChoiceDecision | null;
  onOpen: (d: ChoiceDecision) => void;
}) {
  const [mode, setMode] = useState<"decision" | "information">("decision"),
    [input, setInput] = useState(""),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [configured, setConfigured] = useState<boolean | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setConfigured(d.modelConfigured === true))
      .catch(() => setConfigured(false));
    return () => controller.current?.abort();
  }, []);
  const run = async () => {
    if (mode === "information") {
      const d = blankDecision(
        "Compare this offer with an alternative. Confirm the decision goal and conditions before choosing.",
      );
      d.title = "Understand an offer";
      d.options[0].name = "This offer";
      d.options[1].name = "Alternative";
      d.options[0].materials.push({
        id: uid(),
        title: "Pasted information",
        text: input.trim(),
      });
      d.factors.push(
        makeFactor(d, "Initial payment", {
          dataType: "money",
          unit: d.currency,
          ruleId: "upfront",
        }),
      );
      d.factors.push(
        makeFactor(d, "Recurring payment", {
          dataType: "money",
          unit: d.currency,
          ruleId: "recurring",
        }),
      );
      d.factors.push(
        makeFactor(d, "Billing interval", {
          dataType: "number",
          unit: "months",
          ruleId: "billing_months",
        }),
      );
      d.factors.push(makeFactor(d, "Exit terms", { dataType: "text" }));
      onOpen(d);
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const d = await understand(input.trim(), abort.signal);
      if (!abort.signal.aborted) onOpen(d);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "The decision could not be understood.",
        );
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  return (
    <main className="page-wrap pb-20 pt-12 sm:pt-20">
      <div className="mx-auto max-w-3xl text-center">
        <Badge className="border border-blue-100 bg-white text-near">
          <Compass size={13} className="mr-2" /> A little perspective before a
          big decision
        </Badge>
        <h1 className="display mt-6 text-5xl font-extrabold leading-[1.12] sm:text-7xl">
          See your choices.
          <br />
          <span className="text-near">Picture your life.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-muted">
          Understand what matters, compare the tradeoffs, and explore what each
          choice could mean for your money, time, and plans.
        </p>
      </div>
      <Card className="mx-auto mt-10 max-w-3xl overflow-hidden p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap gap-2">
          <Button
            variant={mode === "decision" ? "subtle" : "ghost"}
            onClick={() => setMode("decision")}
            disabled={busy}
          >
            <GitCompareArrows size={16} /> Help me choose
          </Button>
          <Button
            variant={mode === "information" ? "subtle" : "ghost"}
            onClick={() => setMode("information")}
            disabled={busy}
          >
            <FileSearch size={16} /> Help me understand this
          </Button>
        </div>
        <label htmlFor="choice-input" className="text-base font-bold">
          {mode === "decision"
            ? "What decision is on your mind?"
            : "What information would you like to check?"}
        </label>
        <textarea
          id="choice-input"
          className="choice-textarea mt-3"
          rows={5}
          maxLength={mode === "decision" ? 8000 : 12000}
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            mode === "decision"
              ? "Should I repair my laptop or replace it? I need it for classes, have a $900 budget, and want to keep it for three years…"
              : "Paste an offer, sales message, pricing details, or service terms…"
          }
        />
        <p className="mt-2 text-xs leading-5 text-muted">
          {mode === "decision"
            ? "Any everyday decision. Include options, your goals, and what you already know. English or Chinese input is welcome; the interface stays in English."
            : "This creates an editable comparison with the text attached to its own option. Open Supporting materials to analyze it, then add alternatives and your requirements."}
        </p>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onOpen(blankDecision(input))}
          >
            Build a comparison manually
          </Button>
          <Button variant="blue" disabled={busy || !input.trim()} onClick={run}>
            {busy
              ? "Understanding with Nemotron…"
              : mode === "decision"
                ? "Explore my choices"
                : "Use this information"}
            <ArrowRight size={16} />
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-muted">
          <span
            className={`h-2 w-2 rounded-full ${configured ? "bg-teal-500" : "bg-slate-300"}`}
          />
          {configured === null
            ? "Checking local model service…"
            : configured
              ? "Model configured · results are validated and need your review"
              : "Live model unavailable · manual comparisons and fictional examples work locally"}
        </div>
      </Card>
      <div className="mx-auto mt-6 max-w-3xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
          Explore a fictional example
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              [
                "gym",
                "Annual or monthly?",
                "Payments, commitment, and a break-even point",
              ],
              [
                "housing",
                "A place for you & your cat",
                "Commute, rent, and a missing pet policy",
              ],
              [
                "courses",
                "What to learn next?",
                "Personal fit, schedule, and time",
              ],
            ] as const
          ).map(([kind, title, text]) => (
            <button
              key={kind}
              disabled={busy}
              onClick={() => onOpen(demoDecision(kind))}
              className="rounded-xl border border-line bg-white p-4 text-left transition hover:border-blue-300 hover:shadow-sm"
            >
              <span className="text-sm font-bold">{title}</span>
              <span className="mt-2 block text-xs leading-5 text-muted">
                {text}
              </span>
              <span className="mt-3 block text-xs font-bold text-near">
                Try example ↗
              </span>
            </button>
          ))}
        </div>
      </div>
      {saved && (
        <div className="mt-6 text-center">
          <Button variant="secondary" onClick={() => onOpen(saved)}>
            Resume: {saved.title}
          </Button>
        </div>
      )}
    </main>
  );
}
function Workspace({
  d,
  edit,
  current,
  last,
  onUndo,
  onHome,
}: {
  d: ChoiceDecision;
  edit: (update: (next: ChoiceDecision) => void, label: string) => void;
  current: () => ChoiceDecision;
  last: { label: string; result: Comparison } | null;
  onUndo: () => void;
  onHome: () => void;
}) {
  const result = useMemo(() => compare(d), [d]);
  const [analyses, setAnalyses] = useState<Record<string, MaterialAnalysis>>(
    {},
  );
  const [tab, setTab] = useState<"compare" | "factors">(
    !d.factors.length ? "factors" : "compare",
  );
  const [setupOpen, setSetupOpen] = useState(d.origin === "model");
  const completion = getCompletionNeeds(d);
  const openSetup = () => {
    setSetupOpen(true);
    requestAnimationFrame(() =>
      document
        .getElementById("comparison-setup")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const [instruction, setInstruction] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const maxCost = Math.max(1, ...result.options.map((o) => o.totalCents ?? 0));
  const addSuggestions = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await suggest(d, instruction.trim());
      if (current().id !== d.id || current().version !== d.version) {
        setNotice(
          "Your decision changed. Please request suggestions again; your edits are preserved.",
        );
        return;
      }
      const merged = mergeSuggestions(d, response.factors);
      edit((draft) => {
        draft.factors = merged.decision.factors;
        draft.questions = response.questions;
      }, "Added proposed factors for review");
      setNotice(
        `${merged.added.length} proposed factors added. ${merged.duplicates.length ? `Possible duplicates were kept separate from your data and not added: ${merged.duplicates.join(", ")}.` : "Review and confirm each proposal; similar concepts should be combined."}`,
      );
      setInstruction("");
      setTab("factors");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Suggestions failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page-wrap pb-20 pt-7">
      <Button variant="ghost" size="sm" className="-ml-3" onClick={onHome}>
        <ArrowLeft size={14} /> Back to decisions
      </Button>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex gap-2">
            <Badge>
              {d.domain} · {d.decisionType.replaceAll("_", " ")}
            </Badge>
            <Badge
              className={
                d.origin === "demo"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-blue-50 text-near"
              }
            >
              {d.origin === "demo"
                ? "Fictional example · no model analysis"
                : d.origin === "model"
                  ? "Model interpretation · review required"
                  : "Your manual comparison"}
            </Badge>
          </div>
          <h1 className="display mt-4 text-3xl font-extrabold sm:text-4xl">
            {d.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">{d.description}</p>
        </div>
        <Badge>Revision {d.version}</Badge>
      </div>
      {!!d.goals.length && (
        <div className="mt-4 flex flex-wrap gap-2">
          {d.goals.map((g, i) => (
            <Badge key={i}>
              {g.basis === "explicit" ? "Your goal" : "Suggested goal"}:{" "}
              {g.text}
            </Badge>
          ))}
        </div>
      )}
      {!!d.questions.length && (
        <Card className="mt-5 border-amber-200 bg-amber-50/50 p-4">
          <h2 className="text-sm font-bold">A few things to clarify</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {d.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Answer in the factor editors, or describe your answers in “Add a
            detail” below.
          </p>
        </Card>
      )}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Shared conditions</h2>
          <span className="text-xs text-muted">
            Changes update every related option · no model call
          </span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="field-label">
            Compare over (months)
            <Input
              aria-label="Use horizon in months"
              type="number"
              min={1}
              max={120}
              value={d.context.months ?? ""}
              placeholder="Unknown"
              onChange={(e) =>
                edit((n) => {
                  n.context.months =
                    e.target.value === "" ? null : Number(e.target.value);
                  n.context.source = userSource;
                }, "Shared use horizon changed")
              }
            />
          </label>
          <label className="field-label">
            Uses per week
            <Input
              aria-label="Uses per week"
              type="number"
              min={0}
              max={168}
              step="any"
              value={d.context.usesPerWeek ?? ""}
              placeholder="Unknown"
              onChange={(e) =>
                edit((n) => {
                  n.context.usesPerWeek =
                    e.target.value === "" ? null : Number(e.target.value);
                  n.context.source = userSource;
                }, "Shared use frequency changed")
              }
            />
          </label>
          <label className="field-label">
            Budget ({d.currency})
            <Input
              aria-label="Budget"
              type="number"
              min={0}
              step="0.01"
              value={
                d.context.budgetCents === null
                  ? ""
                  : d.context.budgetCents / 100
              }
              placeholder="No budget constraint"
              onChange={(e) =>
                edit((n) => {
                  n.context.budgetCents =
                    e.target.value === ""
                      ? null
                      : Math.round(Number(e.target.value) * 100);
                  n.context.source = userSource;
                }, "Shared budget changed")
              }
            />
          </label>
          <label className="field-label">
            Budget applies to
            <select
              className={selectClass}
              aria-label="Budget scope"
              value={d.context.budgetScope}
              onChange={(e) =>
                edit((n) => {
                  n.context.budgetScope = e.target.value as
                    "total" | "first_payment";
                }, "Budget scope changed")
              }
            >
              <option value="total">Total over the horizon</option>
              <option value="first_payment">First month / first payment</option>
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-muted">
          Usage uses 52 weeks / 12 months. Frequency is your assumption; it does
          not predict attendance. Currency: {d.currency}.{" "}
          {d.context.source.kind === "demo"
            ? "Shared values are fictional."
            : `Source: ${d.context.source.kind}.`}
        </p>
      </Card>
      <section
        className={`mt-6 rounded-2xl border p-5 sm:p-6 ${["invalid", "no_feasible"].includes(result.status) ? "border-red-200 bg-red-50" : result.status === "insufficient" ? "border-amber-200 bg-amber-50" : "border-blue-100 bg-blue-50/60"}`}
        aria-live="polite"
      >
        <p className="section-label">Your current picture</p>
        <h2
          data-testid="conclusion"
          className="mt-2 text-lg font-bold leading-7"
        >
          {result.message}
        </h2>
        <p className="mt-2 text-xs text-muted">
          Confirmed must-haves come first. Material language is not used as a
          score. Reference factors do not decide the result.
        </p>
        {!!result.issues.length && (
          <ul className="mt-3 list-disc pl-5 text-sm text-red-700">
            {result.issues.slice(0, 8).map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        )}
      </section>
      {last && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
          <span className="text-xs">
            <span className="font-bold">Latest change:</span> {last.label} →
            recalculated costs, conditions, and summaries
          </span>
          <Button size="sm" variant="ghost" onClick={onUndo}>
            <RotateCcw size={14} /> Undo
          </Button>
        </div>
      )}
      <nav
        className="my-6 flex flex-wrap gap-2"
        aria-label="Comparison sections"
      >
        <Button
          variant={tab === "compare" ? "primary" : "secondary"}
          onClick={() => setTab("compare")}
        >
          Compare & picture life
        </Button>
        <Button
          variant={tab === "factors" ? "primary" : "secondary"}
          onClick={() => setTab("factors")}
        >
          Factors & options <Badge>{d.factors.length}</Badge>
        </Button>
      </nav>
      {tab === "factors" ? (
        <div className="space-y-7">
          <details
            className="rounded-2xl border border-line bg-white p-5"
            open={!d.factors.length}
          >
            <summary className="cursor-pointer font-bold">
              Decision and options
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="field-label">
                Decision title
                <Input
                  value={d.title}
                  maxLength={200}
                  onChange={(e) =>
                    edit((n) => {
                      n.title = e.target.value;
                    }, "Decision title changed")
                  }
                />
              </label>
              <label className="field-label">
                Currency (does not convert existing values)
                <select
                  className={selectClass}
                  value={d.currency}
                  onChange={(e) =>
                    edit((n) => {
                      const old = n.currency;
                      n.currency = e.target.value as ChoiceDecision["currency"];
                      n.factors
                        .filter((f) => f.dataType === "money" && f.unit === old)
                        .forEach((f) => {
                          f.unit = n.currency;
                        });
                    }, "Currency label changed; review money values")
                  }
                >
                  {["USD", "CNY", "EUR", "GBP"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              {d.options.map((o) => (
                <div key={o.id} className="flex items-end gap-2">
                  <label className="field-label flex-1">
                    Option name
                    <Input
                      value={o.name}
                      aria-label={`Rename ${o.name}`}
                      maxLength={100}
                      onChange={(e) =>
                        edit((n) => {
                          n.options.find((x) => x.id === o.id)!.name =
                            e.target.value;
                        }, "Option renamed")
                      }
                    />
                  </label>
                  {d.options.length > 2 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        edit((n) => {
                          n.options = n.options.filter((x) => x.id !== o.id);
                          n.factors.forEach((f) => {
                            f.optionIds = f.optionIds.filter(
                              (id) => id !== o.id,
                            );
                            delete f.values[o.id];
                          });
                          n.factors = n.factors.filter(
                            (f) => f.optionIds.length,
                          );
                          if (
                            !n.factors.some((f) => f.id === n.primaryFactorId)
                          )
                            n.primaryFactorId = null;
                        }, `Removed ${o.name}`)
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              className="mt-3"
              disabled={d.options.length >= 6}
              onClick={() =>
                edit((n) => {
                  const id = uid();
                  n.options.push({
                    id,
                    name: `Option ${String.fromCharCode(65 + n.options.length)}`,
                    description: "",
                    materials: [],
                  });
                  n.factors.forEach((f) => {
                    f.optionIds.push(id);
                    f.values[id] = unknownValue();
                  });
                }, "Added an alternative with unknown values")
              }
            >
              <Plus size={15} /> Add an option (including wait / do nothing)
            </Button>
          </details>
          <Factors d={d} edit={edit} />
        </div>
      ) : (
        <div className="space-y-6">
          <CompletionGuide
            d={d}
            edit={edit}
            open={setupOpen}
            onOpen={setSetupOpen}
            onFactors={() => setTab("factors")}
          />
          <div className="grid items-start gap-5 lg:grid-cols-2">
            {d.options.map((o, i) => {
              const r = result.options.find((r) => r.optionId === o.id);
              return (
                <Card
                  key={o.id}
                  className="min-w-0 overflow-hidden"
                  data-testid={`option-${i}`}
                >
                  <div className="h-1.5" style={{ background: colors[i] }} />
                  <div className="p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="section-label">
                          Option {String.fromCharCode(65 + i)}
                        </p>
                        <h2 className="mt-2 text-2xl font-bold">{o.name}</h2>
                      </div>
                      <Badge
                        className={
                          r?.feasibility === "blocked"
                            ? "bg-red-100 text-red-700"
                            : r?.feasibility === "uncertain"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-teal-50 text-teal-700"
                        }
                      >
                        {r?.feasibility === "blocked"
                          ? "Fails a must-have"
                          : r?.feasibility === "uncertain"
                            ? "Needs confirmation"
                            : r
                              ? "Conditions met"
                              : "Invalid inputs"}
                      </Badge>
                    </div>
                    {o.description && (
                      <p className="mt-2 text-xs text-muted">{o.description}</p>
                    )}
                    {r && (
                      <>
                        <div className="mt-5 grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
                          <div>
                            <p className="text-xs text-muted">
                              Total · {d.context.months ?? "?"} months
                            </p>
                            <p
                              data-testid="total"
                              className="number mt-1 text-3xl font-extrabold"
                              style={{ color: colors[i] }}
                            >
                              {money(r.totalCents, d.currency)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted">Time per month</p>
                            <p className="number mt-1 text-xl font-bold">
                              {r.monthlyMinutes === null
                                ? "Unknown"
                                : `${r.monthlyMinutes} min`}
                            </p>
                          </div>
                        </div>
                        {(completion.factors.some((need) =>
                          d.factors
                            .find((f) => f.id === need.factorId)
                            ?.optionIds.includes(o.id),
                        ) ||
                          completion.missingMonths ||
                          completion.missingUsage ||
                          completion.missingBillingOptionIds.includes(
                            o.id,
                          )) && (
                          <Button
                            className="mt-3"
                            size="sm"
                            variant="subtle"
                            onClick={openSetup}
                          >
                            Add or confirm missing inputs
                          </Button>
                        )}
                        <div
                          className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"
                          role="img"
                          aria-label={`${o.name} total cost: ${money(r.totalCents, d.currency)}; shared scale across options`}
                        >
                          <div
                            className="h-full rounded-full transition-[width]"
                            style={{
                              width: `${r.totalCents === null ? 0 : (r.totalCents / maxCost) * 100}%`,
                              background: colors[i],
                            }}
                          />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted">
                          <p>
                            First month:{" "}
                            <strong className="text-ink">
                              {money(r.firstPaymentCents, d.currency)}
                            </strong>
                          </p>
                          <p>
                            Per use:{" "}
                            <strong className="text-ink">
                              {money(r.perUseCents, d.currency)}
                            </strong>
                          </p>
                        </div>
                        <div className="mt-4 space-y-1">
                          {r.constraints.map((c) => (
                            <p
                              key={c.factorId}
                              className={`text-xs ${c.status === "fail" ? "text-red-700" : c.status === "unknown" ? "text-amber-800" : "text-teal-700"}`}
                            >
                              {c.status === "pass"
                                ? "✓"
                                : c.status === "fail"
                                  ? "×"
                                  : "?"}{" "}
                              {c.name} · {c.detail}
                            </p>
                          ))}
                        </div>
                        <details className="mt-4 rounded-xl border border-line p-3">
                          <summary className="cursor-pointer text-xs font-bold">
                            Key parameters & sources
                          </summary>
                          <div className="mt-2 space-y-2">
                            {d.factors
                              .filter((f) => f.optionIds.includes(o.id))
                              .map((f) => (
                                <p key={f.id} className="break-words text-xs">
                                  <strong>{f.name}:</strong>{" "}
                                  {f.values[o.id]?.value === null
                                    ? "Unknown"
                                    : f.dataType === "money"
                                      ? money(
                                          Number(f.values[o.id]?.value),
                                          d.currency,
                                        )
                                      : String(f.values[o.id]?.value)}{" "}
                                  <span className="text-muted">
                                    ({f.values[o.id]?.source.kind};{" "}
                                    {f.confirmed ? "confirmed" : "proposed"}) ·{" "}
                                    {f.values[o.id]?.source.note}
                                  </span>
                                </p>
                              ))}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-2"
                            onClick={() => setTab("factors")}
                          >
                            Edit factors
                          </Button>
                        </details>
                        {last && (
                          <div className="mt-5 rounded-xl bg-slate-50 p-3">
                            <p className="text-xs font-bold">
                              {last.label} → Direct effects → Comparison
                            </p>
                            <ul className="mt-2 space-y-1 text-xs leading-5 text-muted">
                              {impact(
                                last.result,
                                result,
                                o.id,
                                d.currency,
                              ).map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                            <p className="mt-2 text-[11px] text-muted">
                              Possible lifestyle changes require your own
                              assumptions; they are not automatic consequences.
                            </p>
                          </div>
                        )}
                        <div className="mt-6">
                          <h3 className="font-bold">Life with this choice</h3>
                          <p className="mt-1 text-xs text-muted">
                            Instant summary · current revision · shared
                            calculation results
                          </p>
                          <div className="mt-4 space-y-4">
                            {lifeSummary(d, r).map((s) => (
                              <div key={s.label}>
                                <p
                                  className="text-[11px] font-bold uppercase tracking-wide"
                                  style={{ color: colors[i] }}
                                >
                                  {s.label}
                                </p>
                                <p className="mt-1 text-sm leading-6 text-muted">
                                  {s.text}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                    <Materials
                      d={d}
                      optionId={o.id}
                      current={current}
                      edit={edit}
                      analysis={analyses[o.id] ?? null}
                      onAnalysis={(analysis) =>
                        setAnalyses((previous) => ({
                          ...previous,
                          [o.id]: analysis,
                        }))
                      }
                    />
                  </div>
                </Card>
              );
            })}
          </div>
          {result.status !== "invalid" && (
            <>
              <Charts d={d} result={result} />
              {!!result.breakpoints.length && (
                <Card className="p-5">
                  <h3 className="font-bold">Cost boundaries in this horizon</h3>
                  {result.breakpoints.map((b) => (
                    <p key={b.month} className="mt-2 text-sm text-muted">
                      {b.text}
                    </p>
                  ))}
                  <p className="mt-3 text-xs text-muted">
                    Cost boundaries do not override must-haves or predict future
                    use. Extend the horizon to inspect later months.
                  </p>
                </Card>
              )}
            </>
          )}
        </div>
      )}
      <Card className="mt-7 p-5">
        <h2 className="font-bold">Add a detail, in your own words</h2>
        <p className="mt-1 text-sm text-muted">
          “I need to bring my cat.” “My commute should be under half an hour.”
          “I care more about being able to leave.”
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Input
            aria-label="Additional requirements"
            value={instruction}
            maxLength={4000}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="What else should this comparison consider?"
          />
          <Button
            variant="subtle"
            disabled={
              busy || !instruction.trim() || result.status === "invalid"
            }
            onClick={addSuggestions}
          >
            <Sparkles size={15} />
            {busy ? "Requesting suggestions…" : "Suggest factors"}
          </Button>
        </div>
        {notice && (
          <p role="status" className="mt-3 text-sm leading-6 text-muted">
            {notice}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          Only this button requests a model update. Suggestions require
          confirmation and cannot replace your existing factors.
        </p>
      </Card>
    </main>
  );
}
export default function ClearChoiceApp() {
  const [d, setDecision] = useState<ChoiceDecision | null>(restore),
    [home, setHome] = useState(true);
  const [last, setLast] = useState<{
    label: string;
    result: Comparison;
    decision: ChoiceDecision;
  } | null>(null);
  const [saveError, setSaveError] = useState("");
  const ref = useRef(d);
  ref.current = d;
  useEffect(() => {
    if (!d || !decisionSchema.safeParse(d).success) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(d));
      setSaveError("");
    } catch {
      setSaveError(
        "Browser storage is unavailable. Keep this tab open to preserve your edits.",
      );
    }
  }, [d]);
  const open = (next: ChoiceDecision) => {
    ref.current = next;
    setDecision(next);
    setLast(null);
    setHome(false);
    window.scrollTo({ top: 0 });
  };
  const edit = (update: (next: ChoiceDecision) => void, label: string) => {
    if (!ref.current) return;
    const before = ref.current,
      next = structuredClone(before);
    update(next);
    next.version = before.version + 1;
    setLast({ label, result: compare(before), decision: before });
    ref.current = next;
    setDecision(next);
  };
  return (
    <div className="app-shell">
      <header className="border-b border-line bg-white/80">
        <div className="page-wrap flex min-h-[76px] items-center justify-between gap-3">
          <button
            aria-label="Clear Choice home"
            onClick={() => setHome(true)}
            className="flex items-center gap-3"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-white">
              <GitCompareArrows size={21} />
            </span>
            <span className="text-lg font-extrabold tracking-tight">
              Clear Choice<span className="text-near">.</span>
            </span>
          </button>
          <span className="hidden text-xs text-muted sm:block">
            Understand. Compare. Reconsider.
          </span>
          <Badge className="bg-teal-50 text-teal-700">Local workspace</Badge>
        </div>
      </header>
      {saveError && (
        <p role="alert" className="page-wrap pt-3 text-sm text-amber-800">
          {saveError}
        </p>
      )}
      {home || !d ? (
        <Home saved={d} onOpen={open} />
      ) : (
        <Workspace
          key={d.id}
          d={d}
          current={() => ref.current!}
          edit={edit}
          last={last}
          onHome={() => setHome(true)}
          onUndo={() => {
            if (!last) return;
            const restored = structuredClone(last.decision);
            restored.version = d.version + 1;
            ref.current = restored;
            setDecision(restored);
            setLast(null);
          }}
        />
      )}
      <footer className="border-t border-line bg-white/60 py-7">
        <div className="page-wrap flex flex-wrap justify-between gap-3 text-xs text-muted">
          <span>Clear Choice · A clearer view of your next step.</span>
          <span>
            Saved in this browser · No material required ·{" "}
            <a
              href="#legacy"
              onClick={() =>
                window.location.assign(`${window.location.pathname}#legacy`)
              }
              className="underline"
            >
              Original Dayfork workspace
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
