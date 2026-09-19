import { useState } from "react";
import {
  Check,
  ChevronDown,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Badge, Button, Card, Input } from "../components/ui";
import {
  type ChoiceDecision,
  type Factor,
  type Scalar,
  userSource,
  normalizeName,
} from "./schema";
import { makeFactor } from "./fixtures";

export const selectClass =
  "h-10 min-w-0 rounded-lg border border-line bg-white px-2 text-sm text-ink";
export function ValueInput({
  value,
  factor,
  label,
  onChange,
}: {
  value: Scalar;
  factor: Pick<Factor, "dataType" | "allowedValues">;
  label: string;
  onChange: (v: Scalar) => void;
}) {
  if (factor.dataType === "boolean")
    return (
      <select
        className={selectClass}
        aria-label={label}
        value={value === null ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value === "true")
        }
      >
        <option value="">Unknown</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  if (factor.dataType === "category" && factor.allowedValues.length)
    return (
      <select
        className={selectClass}
        aria-label={label}
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Unknown</option>
        {factor.allowedValues.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    );
  const number = ["number", "money", "duration"].includes(factor.dataType),
    scale = factor.dataType === "money" ? 100 : 1;
  return (
    <Input
      className="h-10"
      aria-label={label}
      type={number ? "number" : factor.dataType === "date" ? "date" : "text"}
      step={number ? "any" : undefined}
      placeholder="Unknown"
      value={
        value === null
          ? ""
          : number && typeof value === "number"
            ? value / scale
            : String(value)
      }
      onChange={(e) =>
        onChange(
          e.target.value === ""
            ? null
            : number
              ? factor.dataType === "money"
                ? Math.round(Number(e.target.value) * scale)
                : Number(e.target.value)
              : e.target.value,
        )
      }
    />
  );
}
export function FactorEditor({
  d,
  f,
  onEdit,
  onRemove,
  onPrimary,
}: {
  d: ChoiceDecision;
  f: Factor;
  onEdit: (next: Factor) => void;
  onRemove: () => void;
  onPrimary: () => void;
}) {
  const [settings, setSettings] = useState(false);
  const patch = (change: Partial<Factor>) =>
    onEdit({ ...f, ...change, source: userSource });
  return (
    <Card
      data-factor-name={f.name}
      className={`p-4 sm:p-5 ${!f.confirmed ? "border-amber-200 bg-amber-50/20" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">{f.name}</h3>
            <Badge>
              {f.purpose === "hard"
                ? "Must-have"
                : f.purpose === "preference"
                  ? "Preference"
                  : "Reference"}
            </Badge>
            {!f.confirmed && (
              <Badge className="bg-amber-100 text-amber-800">
                Proposed · review
              </Badge>
            )}
            {d.primaryFactorId === f.id && (
              <Badge className="bg-blue-50 text-near">Primary</Badge>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">{f.reason}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Edit ${f.name}`}
          onClick={() => setSettings(!settings)}
        >
          <SlidersHorizontal size={16} />
        </Button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {d.options
          .filter((o) => f.optionIds.includes(o.id))
          .map((o) => (
            <label key={o.id} className="grid gap-1.5 text-xs font-semibold">
              <span>
                {o.name}
                {f.unit ? ` · ${f.unit}` : ""}
              </span>
              <ValueInput
                label={`${f.name} — ${o.name}`}
                factor={f}
                value={f.values[o.id]?.value ?? null}
                onChange={(value) =>
                  patch({
                    values: {
                      ...f.values,
                      [o.id]: { value, source: userSource },
                    },
                  })
                }
              />
              <span
                className="font-normal text-muted"
                title={f.values[o.id]?.source.note}
              >
                {f.values[o.id]?.source.kind ?? "unknown"}
                {f.values[o.id]?.source.quote
                  ? ` · “${f.values[o.id].source.quote}”`
                  : ""}
              </span>
            </label>
          ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {!f.confirmed && (
          <Button
            size="sm"
            variant="subtle"
            onClick={() => patch({ confirmed: true })}
          >
            <Check size={14} /> Confirm factor
          </Button>
        )}
        {f.purpose === "preference" && f.confirmed && (
          <Button
            size="sm"
            variant={d.primaryFactorId === f.id ? "subtle" : "ghost"}
            onClick={onPrimary}
          >
            {d.primaryFactorId === f.id
              ? "Clear primary preference"
              : "Make primary preference"}
          </Button>
        )}
      </div>
      {settings && (
        <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
          <label className="field-label">
            Name
            <Input
              value={f.name}
              maxLength={100}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <label className="field-label">
            Purpose
            <select
              aria-label={`${f.name} purpose`}
              className={selectClass}
              value={f.purpose}
              onChange={(e) =>
                patch({ purpose: e.target.value as Factor["purpose"] })
              }
            >
              <option value="hard">Must satisfy</option>
              <option value="preference">Preference</option>
              <option value="reference">Reference only</option>
            </select>
          </label>
          <label className="field-label">
            Data type
            <select
              aria-label={`${f.name} data type`}
              className={selectClass}
              value={f.dataType}
              onChange={(e) =>
                patch({
                  dataType: e.target.value as Factor["dataType"],
                  ruleId: null,
                  unit:
                    e.target.value === "money"
                      ? d.currency
                      : e.target.value === "duration"
                        ? "min"
                        : "",
                  direction: "none",
                  target: {},
                })
              }
            >
              {[
                "number",
                "money",
                "duration",
                "date",
                "boolean",
                "category",
                "text",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Unit
            <Input
              value={f.unit}
              maxLength={40}
              onChange={(e) => patch({ unit: e.target.value })}
            />
          </label>
          <label className="field-label">
            Compare by
            <select
              className={selectClass}
              value={f.direction}
              onChange={(e) =>
                patch({ direction: e.target.value as Factor["direction"] })
              }
            >
              <option value="none">No ordering</option>
              <option value="lower">Lower / earlier</option>
              <option value="higher">Higher / later</option>
              <option value="target">Explicit target / range</option>
            </select>
          </label>
          <label className="field-label">
            Importance (organizes factors)
            <select
              className={selectClass}
              value={f.importance}
              onChange={(e) => patch({ importance: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="field-label sm:col-span-2">
            Why it matters
            <Input
              value={f.reason}
              onChange={(e) => patch({ reason: e.target.value })}
            />
          </label>
          {f.dataType === "category" && (
            <label className="field-label sm:col-span-2">
              Your ordered categories (low → high, comma separated)
              <Input
                defaultValue={f.allowedValues.join(", ")}
                onBlur={(e) =>
                  patch({
                    allowedValues: [
                      ...new Set(
                        e.target.value
                          .split(",")
                          .map((v) => v.trim())
                          .filter(Boolean),
                      ),
                    ],
                  })
                }
              />
            </label>
          )}
          {(f.purpose === "hard" || f.direction === "target") && (
            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
              {["number", "money", "duration"].includes(f.dataType) ? (
                <>
                  {["min", "max"].map((key) => (
                    <label key={key} className="field-label">
                      {key === "min" ? "Minimum" : "Maximum"}
                      <ValueInput
                        label={`${f.name} ${key}`}
                        factor={f}
                        value={f.target[key as "min" | "max"] ?? null}
                        onChange={(v) =>
                          patch({
                            target: {
                              ...f.target,
                              [key]: v === null ? undefined : Number(v),
                              equals: undefined,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </>
              ) : (
                <label className="field-label">
                  Required value
                  {f.dataType === "date"
                    ? " (uses earlier / later ordering)"
                    : ""}
                  <ValueInput
                    label={`${f.name} required value`}
                    factor={f}
                    value={f.target.equals ?? null}
                    onChange={(v) => patch({ target: { equals: v } })}
                  />
                </label>
              )}
            </div>
          )}
          <label className="field-label sm:col-span-2">
            Calculation rule
            <select
              aria-label={`${f.name} calculation rule`}
              className={selectClass}
              value={f.ruleId ?? ""}
              onChange={(e) => {
                const ruleId = e.target.value as Factor["ruleId"];
                patch({
                  ruleId: ruleId || null,
                  ...(ruleId
                    ? {
                        dataType: ruleId.includes("time")
                          ? "duration"
                          : ruleId.includes("months")
                            ? "number"
                            : "money",
                        unit: ruleId.includes("time")
                          ? "min"
                          : ruleId.includes("months")
                            ? "months"
                            : d.currency,
                      }
                    : {}),
                });
              }}
            >
              <option value="">No calculation rule</option>
              <option value="upfront">One-time upfront cost (cents)</option>
              <option value="recurring">
                Recurring payment (cents per billing interval)
              </option>
              <option value="billing_months">
                Billing interval (whole months)
              </option>
              <option value="per_use">Additional cost per use (cents)</option>
              <option value="time_per_use">Time per use (minutes)</option>
              <option value="time_monthly">
                Fixed time per month (minutes)
              </option>
              <option value="commitment_months">
                Commitment (whole months)
              </option>
            </select>
            <span className="font-normal text-muted">
              Money inputs are displayed in currency units and stored as cents.
              Rules require compatible units. Unlisted cost components are
              outside the model.
            </span>
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-xs font-semibold">Applies to</legend>
            <div className="flex flex-wrap gap-3">
              {d.options.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={f.optionIds.includes(o.id)}
                    onChange={(e) => {
                      const optionIds = e.target.checked
                        ? [...f.optionIds, o.id]
                        : f.optionIds.filter((id) => id !== o.id);
                      patch({
                        optionIds,
                        values: Object.fromEntries(
                          optionIds.map((id) => [
                            id,
                            f.values[id] ?? {
                              value: null,
                              source: {
                                kind: "unknown",
                                note: "Not provided.",
                              },
                            },
                          ]),
                        ),
                      });
                    }}
                  />
                  {o.name}
                </label>
              ))}
            </div>
          </fieldset>
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start text-red-700"
            onClick={onRemove}
          >
            <Trash2 size={14} /> Remove factor
          </Button>
        </div>
      )}
    </Card>
  );
}
export function Factors({
  d,
  edit,
}: {
  d: ChoiceDecision;
  edit: (update: (next: ChoiceDecision) => void, label: string) => void;
}) {
  const [showAll, setShowAll] = useState(false),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  const sorted = [...d.factors].sort(
    (a, b) =>
      Number(b.purpose === "hard") - Number(a.purpose === "hard") ||
      b.importance - a.importance,
  );
  const visible = showAll
    ? sorted
    : sorted.filter((f, i) => f.purpose === "hard" || i < 4);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">What matters to you</h2>
          <p className="mt-1 text-sm text-muted">
            Must-haves first. One primary preference. Everything else is a
            tradeoff.
          </p>
        </div>
        <Badge>{d.factors.length} factors</Badge>
      </div>
      {visible.map((f) => (
        <FactorEditor
          key={f.id}
          d={d}
          f={f}
          onEdit={(next) =>
            edit((draft) => {
              draft.factors[draft.factors.findIndex((x) => x.id === f.id)] =
                next;
              if (
                draft.primaryFactorId === f.id &&
                (next.purpose !== "preference" || !next.confirmed)
              )
                draft.primaryFactorId = null;
            }, `${f.name} changed`)
          }
          onRemove={() =>
            edit((draft) => {
              draft.factors = draft.factors.filter((x) => x.id !== f.id);
              if (draft.primaryFactorId === f.id) draft.primaryFactorId = null;
            }, `${f.name} removed`)
          }
          onPrimary={() =>
            edit((draft) => {
              draft.primaryFactorId =
                draft.primaryFactorId === f.id ? null : f.id;
            }, `Primary preference changed`)
          }
        />
      ))}
      {sorted.length > 4 && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
          <ChevronDown size={14} />
          {showAll ? "Show fewer factors" : `Show all ${sorted.length} factors`}
        </Button>
      )}
      <Card className="p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (
              d.factors.some(
                (f) => normalizeName(f.name) === normalizeName(name),
              )
            ) {
              setError(
                "A factor with this name already exists. Edit it instead.",
              );
              return;
            }
            if (d.factors.length >= 30) {
              setError("A decision supports up to 30 factors.");
              return;
            }
            edit((draft) => {
              draft.factors.push(makeFactor(draft, name.trim()));
            }, `Added ${name.trim()}`);
            setName("");
            setError("");
            setShowAll(true);
          }}
        >
          <Input
            aria-label="New factor name"
            placeholder="Add something that matters to you…"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="secondary">
            <Plus size={16} /> Add factor
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </Card>
    </section>
  );
}
