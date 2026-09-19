import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../components/ui";
import { type ChoiceDecision } from "./schema";
import { type Comparison } from "./engine";
export const colors = [
  "#3868db",
  "#118878",
  "#9c59c6",
  "#cb8246",
  "#5a8aa5",
  "#ad607a",
];
export function Charts({
  d,
  result,
}: {
  d: ChoiceDecision;
  result: Comparison;
}) {
  const costData = d.options.map((o, i) => ({
    name: o.name,
    cost:
      result.options[i]?.totalCents == null
        ? null
        : result.options[i].totalCents! / 100,
    time: result.options[i]?.monthlyMinutes ?? null,
  }));
  const cumulative = Array.from({ length: d.context.months ?? 0 }, (_, i) =>
    Object.fromEntries([
      ["month", i + 1],
      ...result.options.map((o) => [
        o.optionId,
        o.cumulative[i]?.cents == null ? null : o.cumulative[i].cents! / 100,
      ]),
    ]),
  );
  const hasCost = costData.some((o) => o.cost !== null),
    hasTime = costData.some((o) => o.time !== null);
  if (!hasCost && !hasTime)
    return (
      <Card className="p-5 text-sm text-muted">
        Add known costs or time to see charts. Unknown values have no bar or
        invented score.
      </Card>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {hasCost && d.charts.includes("cost_bar") && (
        <Card className="min-w-0 p-4">
          <h3 className="font-bold">Total spending · {d.currency}</h3>
          <p className="mt-1 text-xs text-muted">
            {d.context.months} months · incomplete options have no bar
          </p>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costData} margin={{ left: 10, right: 10 }}>
                <CartesianGrid vertical={false} stroke="#edf0f5" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar
                  isAnimationActive={false}
                  dataKey="cost"
                  name={d.currency}
                  fill={colors[0]}
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      {hasCost && d.charts.includes("cumulative_cost") && (
        <Card className="min-w-0 p-4">
          <h3 className="font-bold">When does the balance change?</h3>
          <p className="mt-1 text-xs text-muted">
            Cumulative spending · scheduled full payments · {d.currency}
          </p>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cumulative} margin={{ left: 10, right: 15 }}>
                <CartesianGrid stroke="#edf0f5" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {d.options.map((o, i) => (
                  <Line
                    key={o.id}
                    dataKey={o.id}
                    name={o.name}
                    type="stepAfter"
                    stroke={colors[i]}
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                {result.breakpoints.map((b) => (
                  <ReferenceLine
                    key={b.month}
                    x={b.month}
                    stroke="#9b7d4b"
                    strokeDasharray="4 4"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      {hasTime && d.charts.includes("time_bar") && (
        <Card className="min-w-0 p-4">
          <h3 className="font-bold">Time in your month · minutes</h3>
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costData}>
                <CartesianGrid vertical={false} stroke="#edf0f5" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar
                  isAnimationActive={false}
                  dataKey="time"
                  name="Minutes / month"
                  fill={colors[1]}
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}
