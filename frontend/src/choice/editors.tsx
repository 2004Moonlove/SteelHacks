import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../components/ui";
import type { ChoiceDecision, ChoiceOption, CostItem, Currency, Factor, Value } from "./types";

export const freshId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
export const unknownValue = (): Value => ({ value: null, source: "unknown", note: "Not provided" });
export const userValue = (value: Value["value"]): Value => value === null ? unknownValue() : ({ value, source: "user_edit", note: "Entered or confirmed by you" });
export const sourceLabel = (source: Value["source"]) => ({ user_input: "Your input", user_edit: "Your edit", model_suggestion: "AI suggestion", demo: "Fictional example", material: "Material source", unknown: "Unknown", derived: "Calculated" })[source];

export function ValueEditor({ label, value, onChange, type = "number", unit = "", allowedValues = [], scale = 1, min = 0, max, step = "any", compact = false }: {
  label: string; value: Value; onChange: (value: Value) => void; type?: Factor["dataType"]; unit?: string; allowedValues?: string[]; scale?: number; min?: number; max?: number; step?: string; compact?: boolean;
}) {
  const display = value.value === null ? "" : typeof value.value === "number" ? String(value.value / scale) : String(value.value);
  const [text, setText] = useState(display);
  const [invalid, setInvalid] = useState(false);
  const invalidDraft = useRef(false);
  useEffect(() => { if (invalidDraft.current && display === "") return; setText(display); setInvalid(false); invalidDraft.current = false; }, [display]);
  const numeric = ["number", "money", "duration"].includes(type);
  function change(next: string) {
    setText(next);
    let nextValue: Value["value"] = next.trim() === "" ? null : next;
    if (type === "boolean") nextValue = next === "" ? null : next === "true";
    if (numeric && next.trim() !== "") {
      const parsed = Number(next);
      const valid = Number.isFinite(parsed) && Math.abs(parsed * scale) <= Number.MAX_SAFE_INTEGER && parsed >= min && (max === undefined || parsed <= max) && (step !== "1" || Number.isInteger(parsed)) && (type !== "money" || Math.abs(parsed * scale - Math.round(parsed * scale)) < 0.00001);
      setInvalid(!valid); invalidDraft.current = !valid;
      if (!valid) { onChange(unknownValue()); return; }
      nextValue = type === "money" ? Math.round(parsed * scale) : parsed * scale;
    } else { setInvalid(false); invalidDraft.current = false; }
    onChange(userValue(nextValue));
  }
  return <label className={`cc-field ${compact ? "cc-field-compact" : ""}`}>
    <span>{label}{unit && <small>{unit}</small>}</span>
    {type === "boolean" ? <select aria-label={label} value={display} onChange={event => change(event.target.value)}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select>
      : type === "category" && allowedValues.length ? <select aria-label={label} value={display} onChange={event => change(event.target.value)}><option value="">Unknown</option>{allowedValues.map(item => <option key={item} value={item}>{item}</option>)}</select>
      : <input aria-label={label} type={numeric ? "number" : type === "date" ? "date" : "text"} maxLength={numeric ? undefined : 4000} value={text} placeholder="Unknown" min={numeric ? min : undefined} max={numeric ? max : undefined} step={numeric ? step : undefined} onChange={event => change(event.target.value)} />}
    {value.source === "model_suggestion" && value.value !== null && <button type="button" className="cc-confirm-value" onClick={() => onChange(userValue(value.value))}>Confirm suggested value</button>}
    <small className={invalid ? "cc-error-text" : "cc-source"} title={[value.note, value.quote].filter(Boolean).join(" · ")}>{invalid ? `Enter a valid ${step === "1" ? "whole " : ""}value${max ? ` from ${min} to ${max}` : ` of at least ${min}`}.` : `${sourceLabel(value.source)}${value.quote ? ` · “${value.quote}”` : value.note && value.source === "demo" ? ` · ${value.note}` : ""}`}</small>
  </label>;
}

export function OptionEditor({ option, currency, onChange, onRemove, index }: { option: ChoiceOption; currency: Currency; onChange: (option: ChoiceOption, label: string) => void; onRemove?: () => void; index: number }) {
  const edit = (change: (copy: ChoiceOption) => void, label: string) => { const copy = structuredClone(option); change(copy); onChange(copy, label); };
  return <div className="cc-option-editor" style={{ "--option-color": colors[index % colors.length] } as React.CSSProperties}>
    <div className="cc-row"><span className="cc-option-letter">{String.fromCharCode(65 + index)}</span><strong>Option details</strong>{onRemove && <Button variant="ghost" size="icon" aria-label={`Remove ${option.name}`} onClick={onRemove}><Trash2 size={16} /></Button>}</div>
    <label className="cc-field"><span>Name</span><input aria-label={`Option ${String.fromCharCode(65 + index)} name`} maxLength={150} value={option.name} onChange={e => edit(copy => { copy.name = e.target.value; }, "Option name")} /></label>
    <label className="cc-field"><span>What this choice involves</span><textarea aria-label={`${option.name} description`} maxLength={3000} rows={2} value={option.description} onChange={e => edit(copy => { copy.description = e.target.value; }, "Option description")} /></label>
    <div className="cc-subheading"><h4>Charges</h4><Button variant="ghost" size="sm" disabled={option.costs.length >= 30} onClick={() => edit(copy => { copy.costs.push({ id: freshId("cost"), name: "New charge", cadence: "monthly", amount: unknownValue() }); copy.costsComplete = false; }, "Added a charge")}><Plus size={14} /> Add charge</Button></div>
    {!option.costs.length && <p className="cc-hint">No charges entered. If this is free, add an explicit zero charge and confirm the list is complete.</p>}
    {option.costs.map(cost => <div className="cc-cost-editor" key={cost.id}>
      <div className="cc-row"><label className="cc-field cc-grow"><span>Charge name</span><input aria-label={`${option.name} charge name`} maxLength={150} value={cost.name} onChange={e => edit(copy => { copy.costs.find(c => c.id === cost.id)!.name = e.target.value; }, "Charge name")} /></label><Button variant="ghost" size="icon" aria-label={`Remove ${cost.name} from ${option.name}`} onClick={() => edit(copy => { copy.costs = copy.costs.filter(c => c.id !== cost.id); copy.costsComplete = false; }, `Removed ${cost.name}`)}><Trash2 size={15} /></Button></div>
      <div className="cc-two-fields"><ValueEditor label={`${option.name}: ${cost.name}`} value={cost.amount} type="money" unit={currency} scale={100} step="0.01" onChange={amount => edit(copy => { copy.costs.find(c => c.id === cost.id)!.amount = amount; }, `${option.name} · ${cost.name}`)} /><label className="cc-field"><span>Payment timing</span><select aria-label={`${option.name}: ${cost.name} timing`} value={cost.cadence} onChange={e => edit(copy => { copy.costs.find(c => c.id === cost.id)!.cadence = e.target.value as CostItem["cadence"]; }, `${option.name} · payment timing`)}><option value="one_time">Once at the start</option><option value="monthly">Every month</option><option value="annual">Every started year</option><option value="per_use">Each use</option></select></label></div>
    </div>)}
    <label className="cc-checkbox"><input type="checkbox" checked={option.costsComplete} onChange={e => edit(copy => { copy.costsComplete = e.target.checked; }, `${option.name} · cost completeness`)} /> I have included all relevant charges</label>
    <p className="cc-hint">Annual charges are paid upfront for each started year. A missing charge is unknown, not free.</p>
    <details className="cc-detail"><summary>Time inputs <span>Optional · unknown until supplied</span></summary><div className="cc-two-fields"><ValueEditor label={`${option.name}: time per use`} value={option.minutesPerUse} type="duration" unit="minutes / use" onChange={value => edit(copy => { copy.minutesPerUse = value; }, `${option.name} · time per use`)} /><ValueEditor label={`${option.name}: additional monthly time`} value={option.minutesPerMonth} type="duration" unit="minutes / month" onChange={value => edit(copy => { copy.minutesPerMonth = value; }, `${option.name} · monthly time`)} /></div><p className="cc-hint">Per-use time × uses per month + additional monthly time. Enter 0 explicitly if a part does not apply.</p></details>
  </div>;
}

export const colors = ["#3365db", "#0a9181", "#9264d5", "#cf8744", "#ba5981", "#517d98"];
export type EditDecision = (label: string, change: (decision: ChoiceDecision) => void, optionId?: string) => void;
