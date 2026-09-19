import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Sparkles, Star, Trash2, X } from "lucide-react";
import { Badge, Button, Sheet, SheetContent } from "../components/ui";
import { factorSchema } from "./schema";
import { formatValue, mergeSuggestedFactors } from "./engine";
import { suggestFactors } from "./api";
import { freshId, unknownValue, ValueEditor, type EditDecision } from "./editors";
import type { ChoiceCalculation, ChoiceDecision, Factor, RuleId, Value } from "./types";

const ruleNames: Record<RuleId, string> = { total_cost: "Total cost for the horizon", first_payment: "First payment", monthly_payment: "Recurring monthly payment", cost_per_use: "Cost per use", total_time: "Total time for the horizon", monthly_time: "Time per month" };
const purposeLabels = { hard: "Must meet", preference: "Preference", reference: "Reference only" };

function blankFactor(decision: ChoiceDecision): Factor {
  return { id: freshId("factor"), name: "", reason: "", optionIds: decision.options.map(option => option.id), dataType: "number", unit: "", allowedValues: [], direction: "minimize", purpose: "preference", importance: 3, target: { min: null, max: null, desired: null }, values: Object.fromEntries(decision.options.map(option => [option.id, unknownValue()])), origin: "user", confirmed: true };
}

function FactorForm({ initial, decision, onSave, onCancel }: { initial: Factor; decision: ChoiceDecision; onSave: (factor: Factor) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Factor>(() => structuredClone(initial));
  const [error, setError] = useState("");
  const set = (change: (factor: Factor) => void) => setDraft(previous => { const copy = structuredClone(previous); change(copy); return copy; });
  const targetValue = (value: Value["value"]): Value => ({ value, source: "user_edit", note: "Your comparison condition" });
  const save = () => {
    const proposed = { ...draft, name: draft.name.trim(), reason: draft.reason.trim() || "A factor you chose for this decision.", allowedValues: draft.dataType === "category" ? draft.allowedValues.map(value => value.trim()).filter(Boolean) : [], values: Object.fromEntries(Object.entries(draft.values).filter(([id]) => draft.optionIds.includes(id)).map(([id, value]) => [id, value.source === "model_suggestion" ? { ...value, source: "user_edit" as const, note: "AI suggestion explicitly confirmed by you" } : value])), origin: "user" as const, confirmed: true };
    if (proposed.name.length === 0) { setError("Give this factor a name."); return; }
    if (proposed.optionIds.length === 0) { setError("Choose at least one option this factor applies to."); return; }
    if (proposed.purpose === "hard" && Object.values(proposed.target).every(value => value === null)) { setError("A must-meet factor needs an explicit minimum, maximum, or desired value."); return; }
    const duplicate = decision.factors.find(factor => factor.id !== proposed.id && factor.name.trim().toLowerCase() === proposed.name.toLowerCase());
    if (duplicate) { setError("That factor already exists. Edit the existing factor to avoid counting it twice."); return; }
    const parsed = factorSchema.safeParse(proposed);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Please check this factor."); return; }
    onSave(parsed.data as Factor);
  };
  const numeric = ["number", "money", "duration"].includes(draft.dataType);
  const scale = draft.dataType === "money" ? 100 : 1;
  return <div className="cc-form">
    <label className="cc-field"><span>Factor name</span><input aria-label="Factor name" maxLength={150} value={draft.name} placeholder="For example, allows my cat" onChange={e => set(copy => { copy.name = e.target.value; })} /></label>
    <label className="cc-field"><span>Why it matters to you</span><textarea aria-label="Why this factor matters" maxLength={2000} rows={2} value={draft.reason} onChange={e => set(copy => { copy.reason = e.target.value; })} /></label>
    <div className="cc-two-fields"><label className="cc-field"><span>Data type</span><select aria-label="Factor data type" value={draft.dataType} onChange={e => set(copy => { copy.dataType = e.target.value as Factor["dataType"]; copy.values = Object.fromEntries(decision.options.filter(option => copy.optionIds.includes(option.id)).map(option => [option.id, unknownValue()])); copy.target = { min: null, max: null, desired: null }; delete copy.ruleId; if (copy.dataType === "text") { copy.purpose = "reference"; copy.direction = "none"; } else if (copy.dataType === "boolean") copy.direction = "target"; copy.unit = copy.dataType === "money" ? decision.currency : copy.dataType === "duration" ? "minutes" : ""; })}>{["number", "money", "duration", "date", "boolean", "category", "text"].map(type => <option key={type} value={type}>{({ number: "Number", money: "Money", duration: "Duration", date: "Date", boolean: "Yes / no", category: "Category / rating", text: "Text" })[type]}</option>)}</select></label><label className="cc-field"><span>Unit</span><input aria-label="Factor unit" value={draft.unit} placeholder={draft.dataType === "money" ? decision.currency : "For example, kg"} onChange={e => set(copy => { copy.unit = e.target.value; })} /></label></div>
    {draft.dataType === "category" && <label className="cc-field"><span>Allowed values, in your chosen order</span><input aria-label="Allowed factor values" value={draft.allowedValues.join(", ")} placeholder="Low, Medium, High" onChange={e => set(copy => { copy.allowedValues = e.target.value.split(",").map(value => value.trim()); })} /><small>No order is inferred. Only your explicit comparison direction uses this list order.</small></label>}
    <div className="cc-two-fields"><label className="cc-field"><span>How to use it</span><select aria-label="Factor purpose" value={draft.purpose} disabled={draft.dataType === "text"} onChange={e => set(copy => { copy.purpose = e.target.value as Factor["purpose"]; })}><option value="hard">Must meet</option><option value="preference">Preference</option><option value="reference">Reference only</option></select></label><label className="cc-field"><span>Comparison</span><select aria-label="Factor comparison" value={draft.direction} disabled={draft.dataType === "text"} onChange={e => set(copy => { copy.direction = e.target.value as Factor["direction"]; })}><option value="none">No ranking</option>{draft.dataType !== "boolean" && <><option value="minimize">Lower / earlier is better</option><option value="maximize">Higher / later is better</option></>}<option value="target">Desired value / range</option></select></label></div>
    <label className="cc-field"><span>Priority <small>Display order only · no weighted score</small></span><select aria-label="Factor priority" value={draft.importance} onChange={e => set(copy => { copy.importance = Number(e.target.value); })}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} · {value === 5 ? "Highest" : value === 1 ? "Lowest" : "Normal"}</option>)}</select></label>
    {(draft.purpose === "hard" || draft.direction === "target") && draft.dataType !== "text" && <fieldset className="cc-fieldset"><legend>Your explicit condition</legend>{numeric || draft.dataType === "date" ? <div className="cc-two-fields"><ValueEditor label="Minimum target" value={targetValue(draft.target.min)} type={draft.dataType} min={draft.dataType === "number" ? -Number.MAX_SAFE_INTEGER : 0} unit={draft.unit} scale={scale} onChange={value => set(copy => { copy.target.min = value.value as number | string | null; })} /><ValueEditor label="Maximum target" value={targetValue(draft.target.max)} type={draft.dataType} min={draft.dataType === "number" ? -Number.MAX_SAFE_INTEGER : 0} unit={draft.unit} scale={scale} onChange={value => set(copy => { copy.target.max = value.value as number | string | null; })} /></div> : null}<ValueEditor label="Desired value (optional for a range)" value={targetValue(draft.target.desired)} type={draft.dataType} min={draft.dataType === "number" ? -Number.MAX_SAFE_INTEGER : 0} unit={draft.unit} scale={scale} allowedValues={draft.allowedValues} onChange={value => set(copy => { copy.target.desired = value.value; })} /></fieldset>}
    {numeric && <label className="cc-field"><span>Value source</span><select aria-label="Factor calculation rule" value={draft.ruleId ?? "manual"} onChange={e => set(copy => { if (e.target.value === "manual") delete copy.ruleId; else { copy.ruleId = e.target.value as RuleId; copy.dataType = copy.ruleId.includes("time") ? "duration" : "money"; copy.unit = copy.dataType === "money" ? decision.currency : "minutes"; } })}><option value="manual">Enter a value for each option</option>{Object.entries(ruleNames).map(([id, name]) => <option key={id} value={id}>{name} · calculated</option>)}</select></label>}
    <fieldset className="cc-fieldset"><legend>Applies to</legend>{decision.options.map(option => <label className="cc-checkbox" key={option.id}><input type="checkbox" checked={draft.optionIds.includes(option.id)} onChange={e => set(copy => { copy.optionIds = e.target.checked ? [...copy.optionIds, option.id] : copy.optionIds.filter(id => id !== option.id); })} />{option.name}</label>)}</fieldset>
    {draft.ruleId ? <p className="cc-hint">This factor uses {ruleNames[draft.ruleId].toLowerCase()} from the same calculation as your charts and summaries. Edit its underlying charges or time inputs in the option details.</p> : <fieldset className="cc-fieldset"><legend>Option values</legend>{decision.options.filter(option => draft.optionIds.includes(option.id)).map(option => <ValueEditor key={option.id} label={`${option.name} value`} value={draft.values[option.id] ?? unknownValue()} type={draft.dataType} min={draft.dataType === "number" ? -Number.MAX_SAFE_INTEGER : 0} unit={draft.unit} allowedValues={draft.allowedValues} scale={scale} onChange={value => set(copy => { copy.values[option.id] = value; })} />)}</fieldset>}
    <p className="cc-hint">Blank values stay unknown. Subjective descriptions stay qualitative. Saving confirms this factor as your own choice.</p>
    {error && <p role="alert" className="cc-error">{error}</p>}
    <div className="cc-row cc-form-actions"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button variant="blue" onClick={save}><Check size={16} /> Save factor</Button></div>
  </div>;
}

export function FactorSection({ decision, calculation, edit, getCurrent }: { decision: ChoiceDecision; calculation: ChoiceCalculation; edit: EditDecision; getCurrent: () => ChoiceDecision | null }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<Factor | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [proposals, setProposals] = useState<{ factors: Factor[]; questions: string[]; decisionVersion: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const sorted = [...decision.factors].sort((a, b) => b.importance - a.importance);
  const factors = expanded ? sorted : sorted.slice(0, 4);
  async function requestSuggestions() {
    if (!instruction.trim()) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setProposals(null); setNotice("");
    try {
      const result = await suggestFactors(decision, instruction.trim(), abort.signal);
      const current = getCurrent();
      if (result.decisionId !== current?.id || result.decisionVersion !== current.version) throw new Error("Your decision changed while the suggestions were being prepared. Request new suggestions for the current version.");
      setProposals(result); setSelected(result.factors.map(factor => factor.id));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setError(error instanceof Error ? error.message : "Could not suggest factors.");
    } finally { if (!abort.signal.aborted) setBusy(false); }
  }
  const accept = () => {
    if (!proposals) return;
    if (getCurrent()?.version !== proposals.decisionVersion) { setError("The comparison has changed. Request fresh suggestions before adding them."); return; }
    const accepted = proposals.factors.filter(factor => selected.includes(factor.id)).map(factor => ({ ...factor, origin: "user" as const, confirmed: true }));
    const result = mergeSuggestedFactors(decision.factors, accepted);
    if (result.factors.length > 40) { setError("A comparison supports up to 40 factors. Select fewer suggestions or remove a factor first."); return; }
    edit("Confirmed additional factors", copy => { copy.factors = result.factors.map(factor => decision.factors.some(existing => existing.id === factor.id) ? factor : { ...factor, origin: "user", confirmed: true, values: Object.fromEntries(Object.entries(factor.values).map(([id, value]) => [id, value.source === "model_suggestion" ? { ...value, source: "user_edit", note: "AI suggestion explicitly confirmed by you" } : value])) }); });
    setNotice(`${result.factors.length - decision.factors.length} new factor(s) added.${result.skipped.length ? ` Kept existing factors: ${result.skipped.join(", ")}.` : ""}`);
    setProposals(null); setInstruction(""); setExpanded(true);
  };
  return <section className="cc-factor-section" aria-label="Decision factors">
    <div className="cc-section-head"><div><p className="cc-eyebrow">Your decision, your priorities</p><h2>What matters here</h2><p>Must-meet conditions come first. Choose one primary preference to compare eligible options.</p></div><Button variant="secondary" size="sm" disabled={decision.factors.length >= 40} onClick={() => setEditing(blankFactor(decision))}><Plus size={16} /> Add factor</Button></div>
    {!decision.primaryFactorId && <p className="cc-info">No primary preference selected. Review the tradeoffs or choose a preference below to compare on that basis.</p>}
    <div className="cc-factor-grid">{factors.map(factor => <article className={`cc-factor ${decision.primaryFactorId === factor.id ? "cc-factor-primary" : ""}`} key={factor.id}>
      <div className="cc-factor-top"><div className="cc-row"><Badge className={factor.purpose === "hard" ? "bg-amber-50 text-amber-800" : factor.purpose === "preference" ? "bg-blue-50 text-blue-700" : ""}>{purposeLabels[factor.purpose]}</Badge>{decision.primaryFactorId === factor.id && <Badge className="bg-blue-600 text-white"><Star size={10} className="mr-1" /> Primary</Badge>}{!factor.confirmed && <Badge className="bg-purple-50 text-purple-700">Proposal</Badge>}</div><div className="cc-row"><Button variant="ghost" size="icon" aria-label={`Edit ${factor.name}`} onClick={() => setEditing(factor)}><Pencil size={14} /></Button><Button variant="ghost" size="icon" aria-label={`Remove factor ${factor.name}`} onClick={() => edit(`Removed factor: ${factor.name}`, copy => { copy.factors = copy.factors.filter(item => item.id !== factor.id); if (copy.primaryFactorId === factor.id) copy.primaryFactorId = null; })}><Trash2 size={14} /></Button></div></div>
      <h3>{factor.name}</h3><p>{factor.reason || "Added to reflect what matters to you."}</p>{factor.userQuote && <blockquote className="cc-factor-quote"><span>Original wording</span><p>“{factor.userQuote}”</p></blockquote>}
      <div className="cc-factor-values">{decision.options.map(option => { const value = calculation.options.find(result => result.optionId === option.id)?.factorValues[factor.id] ?? factor.values[option.id] ?? unknownValue(); return <div key={option.id}><span>{option.name}</span><strong title={value.note}>{factor.optionIds.includes(option.id) ? formatValue(factor, value, decision.currency) : "Not applicable"}</strong></div>; })}</div>
      {(factor.target.desired !== null || factor.target.min !== null || factor.target.max !== null) && <p className="cc-target">Condition: {factor.target.desired !== null ? `equals ${formatValue(factor, { value: factor.target.desired, source: "user_input", note: "" }, decision.currency)}` : [factor.target.min !== null ? `at least ${formatValue(factor, { value: factor.target.min, source: "user_input", note: "" }, decision.currency)}` : "", factor.target.max !== null ? `at most ${formatValue(factor, { value: factor.target.max, source: "user_input", note: "" }, decision.currency)}` : ""].filter(Boolean).join(" and ")}</p>}
      <div className="cc-factor-foot"><span>{factor.origin === "model" ? "Suggested by AI" : factor.origin === "demo" ? "Fictional example" : "Confirmed by you"} · Priority {factor.importance}</span>{!factor.confirmed ? <Button variant="subtle" size="sm" onClick={() => setEditing(factor)}>Review & confirm</Button> : factor.purpose === "preference" && factor.direction !== "none" && <Button variant="ghost" size="sm" onClick={() => edit(`Primary preference: ${factor.name}`, copy => { const current = copy.factors.find(item => item.id === factor.id)!; current.origin = "user"; current.confirmed = true; copy.primaryFactorId = copy.primaryFactorId === factor.id ? null : factor.id; })}>{decision.primaryFactorId === factor.id ? "Clear primary" : "Make primary"}</Button>}</div>
    </article>)}</div>
    {sorted.length > 4 && <Button variant="ghost" onClick={() => setExpanded(!expanded)}><ChevronDown size={16} />{expanded ? "Show fewer factors" : `Show ${sorted.length - 4} more factors`}</Button>}
    {!factors.length && <div className="cc-empty">Add a factor that matters to you, such as price, an acceptable date, or flexibility.</div>}
    <details className="cc-detail cc-suggestion-box"><summary><Sparkles size={16} /> Add a factor in your own words <span>Explicit AI request</span></summary><div className="cc-row"><textarea aria-label="Additional factor request" maxLength={4000} rows={2} placeholder="For example: I need to bring my cat, and I prefer a commute under 30 minutes." value={instruction} onChange={e => setInstruction(e.target.value)} /><Button variant="blue" disabled={busy || !instruction.trim()} onClick={requestSuggestions}>{busy ? "Thinking…" : "Suggest factors"}</Button></div><p className="cc-hint">Suggestions are reviewed here first. Existing and custom factors are preserved.</p>{error && <p className="cc-error" role="alert">{error}</p>}{notice && <p role="status" className="cc-info">{notice}</p>}
      {proposals && <div className="cc-proposals"><h3>Review new suggestions</h3>{proposals.factors.length === 0 && <p>No new factors were proposed. Your current factors are unchanged.</p>}{proposals.factors.map(factor => <label className="cc-proposal" key={factor.id}><input type="checkbox" checked={selected.includes(factor.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, factor.id] : previous.filter(id => id !== factor.id))} /><div><strong>{factor.name}</strong><p>{factor.reason}</p><small>{purposeLabels[factor.purpose]} · {factor.dataType} · {factor.direction} · {factor.unit || "No unit"}</small>{Object.values(factor.target).some(value => value !== null) && <p>Proposed target: {JSON.stringify(factor.target)}</p>}<p>{decision.options.filter(option => factor.optionIds.includes(option.id)).map(option => `${option.name}: ${formatValue(factor, factor.values[option.id] ?? unknownValue(), decision.currency)}`).join(" · ")}</p></div></label>)}{proposals.questions.map(question => <p className="cc-info" key={question}>{question}</p>)}<div className="cc-row"><Button variant="blue" disabled={!selected.length} onClick={accept}><Check size={16} /> Confirm & add selected</Button><Button variant="ghost" onClick={() => setProposals(null)}><X size={16} /> Dismiss</Button></div></div>}
    </details>
    <Sheet open={editing !== null} onOpenChange={open => { if (!open) setEditing(null); }}><SheetContent title={editing && decision.factors.some(factor => factor.id === editing.id) ? "Edit factor" : "Add a factor"} description="You control its purpose, comparison rule, and source values.">{editing && <FactorForm key={editing.id} initial={editing} decision={decision} onCancel={() => setEditing(null)} onSave={factor => { edit(`Factor: ${factor.name}`, copy => { const index = copy.factors.findIndex(item => item.id === factor.id); if (index < 0) copy.factors.push(factor); else copy.factors[index] = factor; if (copy.primaryFactorId === factor.id && (factor.purpose !== "preference" || factor.direction === "none")) copy.primaryFactorId = null; }); setEditing(null); }} />}</SheetContent></Sheet>
  </section>;
}
