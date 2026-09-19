import { useEffect, useState } from "react";
import type { NumericField } from "../domain";
import { parseCanonicalNumber } from "../lib/units";
import { useAppStore, type FieldPath } from "../store";
import { Badge, Button, Input } from "./ui";

export type NumericEditorProps = {
  label: string;
  field: NumericField;
  path: FieldPath;
  unit: string;
  scale?: number;
  note?: string;
};

function displayedValue(field: NumericField, scale: number): string {
  return field.value === null ? "" : String(field.value / scale);
}

function sourceLabel(field: NumericField) {
  if (field.source === "user_input") return "From your input";
  if (field.source === "user_edit") return "Edited";
  if (field.source === "derived") return "Calculated from input";
  if (field.source === "demo_assumption") return field.confirmed ? "Example confirmed" : "Example assumption";
  return "Missing value";
}

export function NumericEditor({ label, field, path, unit, scale = 1, note }: NumericEditorProps) {
  const updateNumeric = useAppStore((state) => state.updateNumeric);
  const [draft, setDraft] = useState(() => displayedValue(field, scale));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(displayedValue(field, scale)); setError(null); }, [field, scale]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      updateNumeric(path, { value: null, source: "unknown", note: "Enter a value to calculate this scenario." });
      setError("Enter a value to continue.");
      return;
    }
    const next = parseCanonicalNumber(trimmed, scale);
    if (next === null) {
      updateNumeric(path, { value: null, source: "unknown", note: "Enter a valid nonnegative number." });
      setError(`Enter a valid ${unit.toLowerCase()} amount.`);
      return;
    }
    updateNumeric(path, { value: next, source: "user_edit" });
    setError(null);
  };

  return (
    <div className="rounded-xl border border-line bg-slate-50/60 p-3.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-semibold text-ink" htmlFor={`field-${path.join("-")}`}>{label}</label>
        <Badge className={field.source === "unknown" || (field.source === "demo_assumption" && !field.confirmed) ? "bg-amber-50 text-amber-700" : "bg-slate-100"}>{sourceLabel(field)}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Input id={`field-${path.join("-")}`} inputMode="decimal" value={draft} placeholder="Enter value" onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-invalid={!!error} className="bg-white" />
        <span className="min-w-max text-xs font-medium text-muted">{unit}</span>
      </div>
      {field.source === "demo_assumption" && !field.confirmed && (
        <Button type="button" variant="subtle" size="sm" className="mt-2" onClick={() => updateNumeric(path, { ...field, confirmed: true })}>Confirm example value</Button>
      )}
      {(error || note || field.note) && <p className={`mt-2 text-xs leading-5 ${error ? "text-red-600" : "text-muted"}`}>{error || note || field.note}</p>}
    </div>
  );
}
