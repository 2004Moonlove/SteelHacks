import { useRef, useState } from "react";
import { FileText, Plus, Search, Trash2 } from "lucide-react";
import { Badge, Button, Input } from "../components/ui";
import { analyze } from "./api";
import { type ChoiceDecision, type MaterialAnalysis, uid } from "./schema";
import { money } from "./engine";

export function Materials({
  d,
  optionId,
  current,
  edit,
  analysis,
  onAnalysis,
}: {
  d: ChoiceDecision;
  optionId: string;
  current: () => ChoiceDecision;
  analysis: MaterialAnalysis | null;
  onAnalysis: (analysis: MaterialAnalysis) => void;
  edit: (update: (next: ChoiceDecision) => void, label: string) => void;
}) {
  const [title, setTitle] = useState(""),
    [text, setText] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(0);
  const option = d.options.find((o) => o.id === optionId)!;
  const stale = analysis && analysis.version !== d.version;
  const run = async () => {
    const token = ++request.current;
    setBusy(true);
    setError("");
    try {
      const result = await analyze(d, optionId);
      if (token !== request.current) return;
      if (current().id !== d.id || current().version !== d.version) {
        setError(
          "Your decision changed during analysis. Analyze again to use current facts.",
        );
        return;
      }
      onAnalysis(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      if (token === request.current) setBusy(false);
    }
  };
  const displayValue = (factorId: string, value: unknown) => {
    const f = d.factors.find((f) => f.id === factorId);
    return value === null
      ? "Unknown"
      : f?.dataType === "money" && typeof value === "number"
        ? money(value, d.currency)
        : String(value);
  };
  return (
    <details className="mt-5 border-t border-line pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold">
        <FileText size={16} /> Supporting materials{" "}
        <Badge>{option.materials.length}</Badge>
      </summary>
      <div className="mt-4 space-y-3">
        {!option.materials.length && (
          <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
            No materials provided. You can complete this decision without them;
            absence does not indicate lower risk.
          </p>
        )}
        {option.materials.map((m) => (
          <details key={m.id} className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              {m.title}
            </summary>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted">
              {m.text}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 text-red-700"
              onClick={() =>
                edit((draft) => {
                  const o = draft.options.find((o) => o.id === optionId)!;
                  o.materials = o.materials.filter((x) => x.id !== m.id);
                }, `Removed material from ${option.name}`)
              }
            >
              <Trash2 size={13} /> Remove material
            </Button>
          </details>
        ))}
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim() || option.materials.length >= 8) return;
            edit((draft) => {
              draft.options
                .find((o) => o.id === optionId)!
                .materials.push({
                  id: uid(),
                  title:
                    title.trim() || `Material ${option.materials.length + 1}`,
                  text: text.trim(),
                });
            }, `Added material to ${option.name}`);
            setTitle("");
            setText("");
          }}
        >
          <Input
            aria-label={`Material title — ${option.name}`}
            placeholder="Material title (optional)"
            value={title}
            maxLength={150}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="choice-textarea"
            aria-label={`Material text — ${option.name}`}
            rows={3}
            maxLength={12000}
            placeholder="Paste an ad, quote, sales chat, or terms…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={!text.trim() || option.materials.length >= 8}
          >
            <Plus size={14} /> Add material
          </Button>
        </form>
        {!!option.materials.length && (
          <Button size="sm" variant="subtle" disabled={busy} onClick={run}>
            <Search size={14} />
            {busy ? "Analyzing with Nemotron…" : "Analyze all materials"}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {analysis && (
          <div className="space-y-3">
            <Badge
              className={
                stale ? "bg-amber-100 text-amber-800" : "bg-blue-50 text-near"
              }
            >
              {stale
                ? "Previous analysis · decision changed"
                : "Live model output · review findings"}
            </Badge>
            <h4 className="text-sm font-bold">
              {analysis.status === "no_pressure"
                ? "No obvious pressure language found"
                : analysis.status === "inconsistent"
                  ? "Materials contain inconsistent information"
                  : "Information needs verification"}
            </h4>
            <p className="text-xs leading-5 text-muted">
              Pressure language does not prove deception. More materials or
              findings do not make an option worse. Applicable, verified
              discounts can be confirmed below.
            </p>
            {analysis.findings.map((f) => (
              <div className="rounded-xl bg-slate-50 p-3" key={f.id}>
                <div className="flex flex-wrap gap-1">
                  {f.tags.map((tag) => (
                    <Badge key={tag}>{tag.replaceAll("_", " ")}</Badge>
                  ))}
                </div>
                <p className="my-2 text-xs leading-5">{f.explanation}</p>
                {f.evidence.map((e, i) => (
                  <blockquote
                    key={i}
                    className="mt-2 border-l-2 border-slate-300 pl-3 text-xs leading-5 text-muted"
                  >
                    “{e.quote}”
                    <cite className="block not-italic">
                      {option.materials.find((m) => m.id === e.materialId)
                        ?.title ?? "Removed material"}
                    </cite>
                  </blockquote>
                ))}
              </div>
            ))}
            {analysis.extracted.map((e, i) => {
              const f = d.factors.find((f) => f.id === e.factorId);
              if (!f) return null;
              const old = f.values[optionId]?.value;
              return (
                <div key={i} className="rounded-xl border border-amber-200 p-3">
                  <p className="text-sm font-bold">
                    {f.name}: {displayValue(f.id, e.value)}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {old !== null && old !== e.value
                      ? `Conflicts with current value: ${displayValue(f.id, old)}. `
                      : "Proposed value. "}
                    {e.note}
                  </p>
                  <blockquote className="my-2 text-xs text-muted">
                    “{e.quote}”
                  </blockquote>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!stale}
                    onClick={() =>
                      edit((draft) => {
                        const target = draft.factors.find(
                          (f) => f.id === e.factorId,
                        )!;
                        target.values[optionId] = {
                          value: e.value,
                          source: {
                            kind: "material",
                            materialId: e.materialId,
                            quote: e.quote,
                            note: e.note,
                          },
                        };
                      }, `Confirmed ${f.name} from ${option.name} material`)
                    }
                  >
                    Confirm this value
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}
