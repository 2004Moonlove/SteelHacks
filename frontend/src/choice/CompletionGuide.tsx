import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Badge, Button, Card, Input } from "../components/ui";
import { ValueInput } from "./FactorEditor";
import { getCompletionNeeds, needsRequirementTarget } from "./completion";
import { makeFactor } from "./fixtures";
import { money } from "./engine";
import {
  decisionSchema,
  type ChoiceDecision,
  type Factor,
  unknownValue,
  userSource,
} from "./schema";

const ruleHelp: Partial<Record<NonNullable<Factor["ruleId"]>, string>> = {
  upfront:
    "One-time payment, in the selected currency. Enter 0 only if there is no charge.",
  recurring:
    "Full payment each billing period. Keep an annual payment as its full annual amount.",
  billing_months: "Months between payments: 1 for monthly, 12 for annual.",
  per_use: "Additional charge for one use. Enter 0 only if there is no charge.",
  time_per_use:
    "Minutes for one use. Match the weekly frequency to the same unit, such as one-way trips.",
  time_monthly:
    "Additional minutes each month. Do not include time already counted per use.",
};

export function CompletionGuide({
  d,
  edit,
  open,
  onOpen,
  onFactors,
}: {
  d: ChoiceDecision;
  edit: (update: (next: ChoiceDecision) => void, label: string) => void;
  open: boolean;
  onOpen: (value: boolean) => void;
  onFactors: () => void;
}) {
  const needs = getCompletionNeeds(d);
  // Keep edited rows mounted so entering the last missing digit never loses focus.
  const [visited, setVisited] = useState<string[]>([]);
  const [error, setError] = useState("");
  const remember = (id: string) =>
    setVisited((ids) => (ids.includes(id) ? ids : [...ids, id]));
  const rows = d.factors.filter(
    (f) =>
      visited.includes(f.id) || needs.factors.some((n) => n.factorId === f.id),
  );
  const unlinked = d.factors.filter(
    (f) =>
      f.ruleId === null &&
      (f.dataType === "money" || f.dataType === "duration") &&
      f.optionIds.some(
        (id) =>
          d.options.some((o) => o.id === id) &&
          !d.factors.some(
            (candidate) =>
              candidate.optionIds.includes(id) &&
              (f.dataType === "money"
                ? ["upfront", "recurring", "per_use"]
                : ["time_per_use", "time_monthly"]
              ).includes(candidate.ruleId ?? ""),
          ),
      ),
  );
  const valid = decisionSchema.safeParse(d).success;
  const pending =
    unlinked.length +
    needs.factors.length +
    Number(needs.missingMonths) +
    Number(needs.missingUsage) +
    Number(needs.missingBillingOptionIds.length > 0);
  const [touchedContext, setTouchedContext] = useState({
    months: false,
    usage: false,
  });
  const hasHistory =
    visited.length > 0 || touchedContext.months || touchedContext.usage;
  if (!pending && !hasHistory) return null;
  const hasCostNeeds =
    needs.factors.some((n) => n.affects.includes("cost")) ||
    needs.missingMonths ||
    needs.missingBillingOptionIds.length > 0;
  const optionalCount = d.factors.filter(
    (f) =>
      !f.ruleId &&
      f.purpose === "reference" &&
      f.id !== d.primaryFactorId &&
      f.optionIds.some((id) => f.values[id]?.value == null),
  ).length;
  const changeFactor = (f: Factor, update: Partial<Factor>, label: string) => {
    remember(f.id);
    edit((next) => {
      const index = next.factors.findIndex((item) => item.id === f.id);
      next.factors[index] = { ...next.factors[index], ...update };
    }, label);
  };
  return (
    <Card
      id="comparison-setup"
      className="scroll-mt-5 border-blue-200 p-5 sm:p-6"
      data-testid="completion-guide"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">
            {!valid
              ? "Check your entries"
              : pending
                ? "Complete your comparison"
                : "Your key inputs are ready"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            {!valid
              ? "Some entries need correction before results can be calculated. See the input errors above."
              : pending
                ? "The options are ready. Add the missing facts and confirm the proposed factors to calculate your comparison."
                : "Your current values are in use. Results update immediately as you edit."}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onOpen(!open)}
          aria-expanded={open}
        >
          <ChevronDown size={15} />{" "}
          {open ? "Hide input guide" : "Complete key inputs"}
        </Button>
      </div>
      {open && (
        <div className="mt-5 space-y-4">
          <p className="text-xs leading-5 text-muted">
            No values are guessed.{" "}
            {hasCostNeeds && "A budget is a limit, not an option's price. "}
            Confirm only factors that apply; remove or adjust others in Factors
            & options. Editing these fields makes no model calls.
          </p>
          {(needs.missingMonths ||
            needs.missingUsage ||
            touchedContext.months ||
            touchedContext.usage) && (
            <div className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
              {(needs.missingMonths || touchedContext.months) && (
                <label className="field-label">
                  How many months are you comparing?
                  <Input
                    aria-label="Setup comparison months"
                    type="number"
                    min={1}
                    max={120}
                    placeholder="Enter months"
                    value={d.context.months ?? ""}
                    onChange={(e) => {
                      setTouchedContext((state) => ({
                        ...state,
                        months: true,
                      }));
                      edit((next) => {
                        next.context.months =
                          e.target.value === "" ? null : Number(e.target.value);
                        next.context.source = userSource;
                      }, "Comparison horizon entered");
                    }}
                  />
                </label>
              )}
              {(needs.missingUsage || touchedContext.usage) && (
                <label className="field-label">
                  How many uses each week?
                  <Input
                    aria-label="Setup uses per week"
                    type="number"
                    min={0}
                    max={168}
                    step="any"
                    placeholder="Enter weekly frequency"
                    value={d.context.usesPerWeek ?? ""}
                    onChange={(e) => {
                      setTouchedContext((state) => ({ ...state, usage: true }));
                      edit((next) => {
                        next.context.usesPerWeek =
                          e.target.value === "" ? null : Number(e.target.value);
                        next.context.source = userSource;
                      }, "Weekly frequency entered");
                    }}
                  />
                  <span className="font-normal text-muted">
                    Use the same unit as the time or price per use. For one-way
                    commute times, count one-way trips.
                  </span>
                </label>
              )}
            </div>
          )}
          {rows.map((f) => {
            const need = needs.factors.find((n) => n.factorId === f.id);
            const missing = f.optionIds.some(
              (id) => f.values[id]?.value == null,
            );
            return (
              <div
                key={f.id}
                data-setup-factor={f.id}
                className="rounded-xl border border-line p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold">{f.name}</h3>
                  <Badge>
                    {needsRequirementTarget(f)
                      ? "Set a requirement"
                      : !valid
                        ? "Review values"
                        : missing
                          ? "Missing values"
                          : !f.confirmed
                            ? "Review supplied values"
                            : "Ready"}
                  </Badge>
                  {!f.confirmed && (
                    <Badge className="bg-amber-100 text-amber-800">
                      Proposed · review
                    </Badge>
                  )}
                  {need && (
                    <span className="text-xs text-muted">
                      Needed for {need.affects.join(" / ")}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {f.ruleId ? (ruleHelp[f.ruleId] ?? f.reason) : f.reason}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {d.options
                    .filter((o) => f.optionIds.includes(o.id))
                    .map((o) => (
                      <label
                        key={o.id}
                        className="grid min-w-0 gap-1.5 text-xs font-semibold"
                      >
                        <span>
                          {o.name}
                          {f.unit ? ` · ${f.unit}` : ""}
                        </span>
                        <ValueInput
                          label={`Setup ${f.name} — ${o.name}`}
                          factor={f}
                          value={f.values[o.id]?.value ?? null}
                          onChange={(value) =>
                            changeFactor(
                              f,
                              {
                                values: {
                                  ...f.values,
                                  [o.id]: {
                                    value,
                                    source:
                                      value === null
                                        ? unknownValue().source
                                        : userSource,
                                  },
                                },
                              },
                              `${f.name} — ${o.name} updated`,
                            )
                          }
                        />
                        {f.values[o.id]?.source.quote && (
                          <span className="break-words font-normal text-muted">
                            Quoted source: “{f.values[o.id].source.quote}”
                          </span>
                        )}
                      </label>
                    ))}
                </div>
                {!f.confirmed && (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="subtle"
                    onClick={() =>
                      changeFactor(
                        f,
                        { confirmed: true },
                        `${f.name} confirmed for comparison`,
                      )
                    }
                  >
                    <Check size={14} /> Confirm {f.name}
                  </Button>
                )}
                {f.confirmed && missing && (
                  <p className="mt-2 text-xs text-amber-800">
                    This factor is confirmed. Add the remaining values to
                    calculate its effects.
                  </p>
                )}
                {needsRequirementTarget(f) && (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    onClick={onFactors}
                  >
                    Set requirement for {f.name}
                  </Button>
                )}
                {f.purpose === "hard" && (
                  <p className="mt-2 text-xs text-muted">
                    Required: {formatTarget(f, d.currency)}. Review this
                    requirement in Factors & options.
                  </p>
                )}
              </div>
            );
          })}
          {unlinked.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <h3 className="text-sm font-bold">
                Some values are not linked to totals
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted">
                {unlinked.map((f) => f.name).join(", ")} currently have no
                calculation role. Confirming a reference value alone does not
                create a cost or time total. In Factors & options, edit the
                factor and choose the appropriate calculation rule if it should
                affect totals.
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={onFactors}
              >
                Review calculation roles
              </Button>
            </div>
          )}
          {needs.missingBillingOptionIds.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <h3 className="text-sm font-bold">
                How often is the recurring payment charged?
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted">
                A price needs a billing interval before we can calculate a
                total. Add it for{" "}
                {d.options
                  .filter((o) => needs.missingBillingOptionIds.includes(o.id))
                  .map((o) => o.name)
                  .join(", ")}
                , then enter 1 for monthly or 12 for annual billing.
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (d.factors.length >= 30) {
                    setError(
                      "This comparison has 30 factors. Remove an unused factor in Factors & options, then add the billing interval.",
                    );
                    return;
                  }
                  setError("");
                  const ids = needs.missingBillingOptionIds;
                  const f = makeFactor(d, "Billing interval", {
                    dataType: "number",
                    unit: "months",
                    ruleId: "billing_months",
                    optionIds: ids,
                    values: Object.fromEntries(
                      ids.map((id) => [id, unknownValue()]),
                    ),
                    confirmed: false,
                    reason:
                      "Months between recurring payments. Enter the actual payment schedule.",
                  });
                  remember(f.id);
                  edit((next) => {
                    next.factors.push(f);
                  }, "Added billing interval for review");
                }}
              >
                Add billing interval
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {optionalCount > 0 && (
            <p className="text-xs leading-5 text-muted">
              {optionalCount} reference-only{" "}
              {optionalCount === 1 ? "factor can" : "factors can"} stay unknown.
              They do not block cost or time calculations.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={onFactors}>
              Review all factors
            </Button>
            <Button size="sm" onClick={() => onOpen(false)}>
              View current comparison
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function formatTarget(f: Factor, currency: string): string {
  const format = (value: number | string | boolean) =>
    typeof value === "boolean"
      ? value
        ? "Yes"
        : "No"
      : typeof value === "number" && f.dataType === "money"
        ? money(value, currency)
        : `${value}${typeof value === "number" && f.unit ? ` ${f.unit}` : ""}`;
  if (f.target.equals != null) {
    const relation =
      f.dataType === "date"
        ? f.direction === "lower"
          ? "on or before "
          : f.direction === "higher"
            ? "on or after "
            : ""
        : "";
    return relation + format(f.target.equals);
  }
  const bounds = [
    f.target.min !== undefined ? `at least ${format(f.target.min)}` : "",
    f.target.max !== undefined ? `at most ${format(f.target.max)}` : "",
  ].filter(Boolean);
  return (
    bounds.join(" and ") || "set a specific requirement in Factors & options"
  );
}
