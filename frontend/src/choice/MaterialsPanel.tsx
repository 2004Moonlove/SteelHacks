import { useState } from "react";
import { AlertCircle, FileText, Plus, ScanText, Trash2 } from "lucide-react";
import { Badge, Button } from "../components/ui";
import { choiceDecisionSchema } from "./schema";
import { formatMoney, formatValue } from "./engine";
import { freshId, unknownValue, type EditDecision } from "./editors";
import type { ChoiceDecision, ChoiceOption, Extraction, MaterialAnalysis, Value } from "./types";

const statuses: Record<MaterialAnalysis["status"], string> = { no_materials: "No materials provided", no_pressure_found: "No obvious pressure found", needs_verification: "Information to verify", inconsistent: "Materials are inconsistent" };
const tags: Record<string, string> = { urgency: "Urgency", scarcity: "Scarcity", social_pressure: "Social pressure", emotional_pressure: "Emotional pressure", unclear_price: "Unclear price", unclear_terms: "Unclear terms", unsupported_claim: "Unsupported claim", normal_marketing: "Normal marketing", disclosed: "Clearly disclosed", conflict: "Conflict" };

function ExtractionReview({ extraction, decision, option, onApply, onClose }: { extraction: Extraction; decision: ChoiceDecision; option: ChoiceOption; onApply: (copy: ChoiceDecision) => void; onClose: () => void }) {
  const defaultTarget = extraction.costId && option.costs.some(cost => cost.id === extraction.costId) ? `cost:${extraction.costId}` : extraction.factorId && decision.factors.some(factor => factor.id === extraction.factorId && !factor.ruleId) ? `factor:${extraction.factorId}` : "";
  const [target, setTarget] = useState(defaultTarget);
  const [error, setError] = useState("");
  const [timing, setTiming] = useState<"one_time" | "monthly" | "annual" | "per_use">("one_time");
  const separator = target.indexOf(":");
  const kind = separator < 0 ? target : target.slice(0, separator);
  const id = separator < 0 ? "" : target.slice(separator + 1);
  const cost = option.costs.find(item => kind === "cost" && item.id === id);
  const factor = decision.factors.find(item => kind === "factor" && item.id === id);
  const current = cost?.amount ?? factor?.values[option.id] ?? unknownValue();
  const currentText = cost ? formatMoney(typeof current.value === "number" ? current.value : null, decision.currency) : factor ? formatValue(factor, current, decision.currency) : "No existing value";
  const nextText = extraction.unit === decision.currency && typeof extraction.value === "number" ? formatMoney(extraction.value, decision.currency) : `${String(extraction.value)}${extraction.unit ? ` ${extraction.unit}` : ""}`;
  const conflict = current.value !== null && current.value !== extraction.value;
  const apply = () => {
    if (!target) { setError("Choose the parameter this evidence describes."); return; }
    const material = option.materials.find(item => item.id === extraction.materialId);
    if (!material?.text.includes(extraction.quote)) { setError("The source text changed. Analyze the current material before using this value."); return; }
    const value: Value = { value: extraction.value, source: "material", note: `Confirmed from ${material.title || "pasted material"}`, materialId: material.id, quote: extraction.quote };
    const copy = structuredClone(decision);
    const nextOption = copy.options.find(item => item.id === option.id)!;
    if (kind === "cost" || kind === "new_cost") {
      if (extraction.unit !== decision.currency || typeof extraction.value !== "number" || extraction.value < 0 || !Number.isSafeInteger(extraction.value)) { setError(`A charge needs nonnegative integer minor units in ${decision.currency}. This extraction uses ${extraction.unit || "an unspecified unit"}; verify and enter it manually.`); return; }
      if (kind === "cost") nextOption.costs.find(item => item.id === id)!.amount = value;
      else { nextOption.costs.push({ id: freshId("cost"), name: extraction.label, cadence: timing, amount: value }); nextOption.costsComplete = false; }
    } else if (factor) {
      if (factor.unit !== extraction.unit) { setError(`Unit mismatch: this factor uses ${factor.unit || "no unit"}, while the extraction uses ${extraction.unit || "no unit"}. Verify and edit it manually.`); return; }
      copy.factors.find(item => item.id === factor.id)!.values[option.id] = value;
    } else { setError("Choose an existing editable parameter or add a charge."); return; }
    const parsed = choiceDecisionSchema.safeParse(copy);
    if (!parsed.success) { setError(`This value cannot be applied: ${parsed.error.issues[0]?.message}. Check its type and units.`); return; }
    onApply(copy); onClose();
  };
  return <div className="cc-extraction-review"><div className="cc-row"><strong>Confirm where this value belongs</strong><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button></div><blockquote>{extraction.quote}</blockquote><label className="cc-field"><span>Apply to</span><select aria-label={`Apply ${extraction.label} to`} value={target} onChange={e => { setTarget(e.target.value); setError(""); }}><option value="">Choose a parameter</option>{option.costs.map(item => <option key={item.id} value={`cost:${item.id}`}>{item.name} · {item.cadence.replaceAll("_", " ")}</option>)}{decision.factors.filter(item => !item.ruleId && item.optionIds.includes(option.id)).map(item => <option key={item.id} value={`factor:${item.id}`}>{item.name} · {item.unit || item.dataType}</option>)}{extraction.unit === decision.currency && <option value="new_cost:new">Add a new charge</option>}</select></label>{kind === "new_cost" && <label className="cc-field"><span>Payment timing you have verified</span><select aria-label="Extracted charge timing" value={timing} onChange={e => setTiming(e.target.value as typeof timing)}><option value="one_time">One-time</option><option value="monthly">Monthly</option><option value="annual">Annual upfront</option><option value="per_use">Per use</option></select></label>}<p className={conflict ? "cc-warning" : "cc-info"}>{conflict ? "Conflicting value — confirmation required. " : "Review before applying. "}Current: <strong>{currentText}</strong> → Extracted: <strong>{nextText}</strong></p>{error && <p className="cc-error" role="alert">{error}</p>}<Button variant="blue" size="sm" onClick={apply}>{conflict ? "Confirm replacement" : "Confirm & apply value"}</Button><p className="cc-hint">Only this parameter changes. Its material and exact quotation remain attached as the source.</p></div>;
}

export function MaterialsPanel({ decision, option, analysis, busy, error, edit, onAnalyze }: { decision: ChoiceDecision; option: ChoiceOption; analysis?: MaterialAnalysis; busy: boolean; error?: string; edit: EditDecision; onAnalyze: () => void }) {
  const [open, setOpen] = useState(option.materials.length > 0);
  const [review, setReview] = useState<Extraction | null>(null);
  const stale = analysis && analysis.decisionVersion !== decision.version;
  const status = !option.materials.length ? "No materials provided" : !analysis ? "Not analyzed" : stale ? "Previous analysis · inputs changed" : statuses[analysis.status];
  const modifyMaterial = (materialId: string, action: (copy: ChoiceOption) => void, label: string) => edit(label, copy => {
    const next = copy.options.find(item => item.id === option.id)!;
    action(next);
    const check = (value: Value) => {
      if (value.source !== "material" || value.materialId !== materialId) return value;
      const material = next.materials.find(item => item.id === materialId);
      return material && value.quote && material.text.includes(value.quote) ? value : { ...unknownValue(), note: "The material supporting this value changed or was removed. Confirm the value again." };
    };
    next.costs.forEach(cost => { cost.amount = check(cost.amount); });
    next.minutesPerMonth = check(next.minutesPerMonth); next.minutesPerUse = check(next.minutesPerUse);
    copy.factors.forEach(factor => { if (factor.values[option.id]) factor.values[option.id] = check(factor.values[option.id]); });
    copy.context.months = check(copy.context.months); copy.context.usesPerMonth = check(copy.context.usesPerMonth); copy.context.budgetCents = check(copy.context.budgetCents);
  }, option.id);
  return <details className="cc-materials cc-detail" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><FileText size={16} /> Materials <span>{option.materials.length} supplied · {status}</span></summary>
    <p className="cc-hint">Optional ads, chats, quotes, or terms for this option. A pressure phrase is not proof of dishonesty. Material counts never affect the comparison.</p>
    {!option.materials.length && <div className="cc-empty">No materials provided. You can complete this decision without them; absence of material is not evidence of safety.</div>}
    {option.materials.map((material, index) => <div className="cc-material-editor" key={material.id}><div className="cc-row"><label className="cc-field cc-grow"><span>Material {index + 1} title</span><input aria-label={`${option.name} material ${index + 1} title`} maxLength={200} value={material.title} placeholder="For example, website offer" onChange={e => modifyMaterial(material.id, copy => { copy.materials.find(item => item.id === material.id)!.title = e.target.value; }, `${option.name} · material title`)} /></label><Button variant="ghost" size="icon" aria-label={`Remove material ${index + 1} from ${option.name}`} onClick={() => modifyMaterial(material.id, copy => { copy.materials = copy.materials.filter(item => item.id !== material.id); }, `${option.name} · removed material`)}><Trash2 size={15} /></Button></div><textarea aria-label={`${option.name} material ${index + 1} text`} rows={4} maxLength={Math.min(12000, 60000 - decision.options.flatMap(item => item.materials).filter(item => item.id !== material.id).reduce((total, item) => total + item.text.length, 0))} placeholder="Paste the original text here…" value={material.text} onChange={e => modifyMaterial(material.id, copy => { copy.materials.find(item => item.id === material.id)!.text = e.target.value; }, `${option.name} · material text`)} /></div>)}
    <div className="cc-wrap-row"><Button variant="secondary" size="sm" disabled={option.materials.length >= 10} onClick={() => edit(`${option.name} · added material`, copy => { copy.options.find(item => item.id === option.id)!.materials.push({ id: freshId("material"), title: `Material ${option.materials.length + 1}`, text: "" }); }, option.id)}><Plus size={14} /> Add text material</Button><Button variant="blue" size="sm" disabled={busy || !option.materials.some(material => material.text.trim())} onClick={onAnalyze}><ScanText size={15} />{busy ? "Analyzing…" : "Analyze this option"}</Button></div>
    {busy && <p className="cc-hint" role="status">Nemotron is examining the supplied text and checking its sources. This can take a minute.</p>}
    {error && <p role="alert" className="cc-error">{error}</p>}
    {stale && <p className="cc-warning"><AlertCircle size={15} /> Inputs changed after this analysis. Its findings are a previous snapshot; analyze again before applying values.</p>}
    {analysis && option.materials.length > 0 && <div className={`cc-analysis ${stale ? "cc-stale" : ""}`}><Badge className={analysis.status === "inconsistent" ? "bg-amber-100 text-amber-900" : "bg-slate-100"}>{statuses[analysis.status]}</Badge><p className="cc-hint">Model analysis · decision version {analysis.decisionVersion}. Review evidence in context.</p>
      {analysis.findings.length === 0 && <p className="cc-hint">No quoted findings were returned. This does not verify every claim or guarantee favorable terms.</p>}
      {analysis.findings.map(finding => <article className="cc-finding" key={finding.id}><div className="cc-wrap-row">{finding.labels.map(label => <Badge key={label} className={label === "conflict" ? "bg-amber-100 text-amber-900" : ["normal_marketing", "disclosed"].includes(label) ? "bg-teal-50 text-teal-800" : "bg-purple-50 text-purple-800"}>{tags[label]}</Badge>)}</div>{finding.quotes.map((quote, index) => <blockquote key={`${quote.materialId}-${index}`}><p>“{quote.quote}”</p><cite>{option.materials.find(material => material.id === quote.materialId)?.title ?? "Previous material"}</cite></blockquote>)}<p>{finding.explanation}</p>{finding.needsVerification && <small className="cc-error-text">Needs verification</small>}</article>)}
      {analysis.extractions.length > 0 && <div className="cc-extractions"><h4>Extracted facts to review</h4><p className="cc-hint">These are proposals. No price or condition is changed automatically.</p>{analysis.extractions.map(extraction => <div className="cc-extraction" key={extraction.id}><div className="cc-row"><div><strong>{extraction.label}</strong><p>{extraction.unit === decision.currency && typeof extraction.value === "number" ? formatMoney(extraction.value, decision.currency) : `${String(extraction.value)} ${extraction.unit}`}</p></div><Button variant="secondary" size="sm" disabled={stale} onClick={() => setReview(extraction)}>Review value</Button></div>{review?.id === extraction.id && !stale && <ExtractionReview extraction={extraction} decision={decision} option={option} onClose={() => setReview(null)} onApply={next => edit(`${option.name} · confirmed ${extraction.label}`, copy => { copy.options = next.options; copy.factors = next.factors; }, option.id)} />}</div>)}</div>}
      {analysis.limitations.map((limitation, index) => <p className="cc-hint" key={index}>{limitation}</p>)}
    </div>}
  </details>;
}
