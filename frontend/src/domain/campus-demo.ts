import { demoDecision } from "./demo";
import type { Decision, NumericField } from "./types";
const example = (value: number, note: string): NumericField => ({ value, source: "demo_assumption", confirmed: true, note });

/** Richer current demo without changing the legacy arithmetic fixture. */
export const campusDemoDecision: Decision = {
  ...structuredClone(demoDecision),
  schemaVersion: 2, comparisonMode: "quantitative", id: "campus-housing-mixed-demo",
  title: "Live on campus or off campus?",
  description: "Compare the monthly budget and travel in an illustrative housing setup, then explore the parts of campus life that matter to you.",
  originalInput: "Should I live on campus or off campus?",
  options: [
    { ...structuredClone(demoDecision.options[0]), name: "On campus" },
    { ...structuredClone(demoDecision.options[1]), name: "Off campus" },
  ],
  tags: [
    ...structuredClone(demoDecision.tags.slice(0, 3)).map((tag) => ({ ...tag, group: "Travel routine" })),
    { id: "utilities", type: "fixed", name: "Utilities billed separately", group: "Household budget", description: "Add utilities only when they are not already included in the rent being compared.", targets: [{ optionId: "far", costCentsMonthly: example(9000, "Illustrative separate monthly utility bill."), minutesMonthly: example(0, "No direct activity time is modeled for this bill.") }] },
    { id: "meal-upgrade", type: "fixed", name: "A meal plan upgrade", group: "Household budget", description: "Add the incremental cost of an optional campus meal plan upgrade.", targets: [{ optionId: "near", costCentsMonthly: example(12000, "Illustrative additional monthly plan cost, not the total food budget."), minutesMonthly: example(0, "This upgrade does not model a change to meal preparation time.") }] },
    { id: "household-care", type: "fixed", name: "Extra household upkeep", group: "Household budget", description: "Include additional supply spending and tracked upkeep time for managing a separate household.", targets: [{ optionId: "far", costCentsMonthly: example(2000, "Illustrative additional monthly supply cost."), minutesMonthly: example(120, "Illustrative additional upkeep time per month.") }] },
    { id: "social-connection", type: "consideration", name: "Being part of campus life", group: "Personal priorities", description: "Explore informal contact with classmates and the campus community.", targets: [{ optionId: "near", consideration: "If classmates spend time nearby, living on campus could make spontaneous conversations part of returning home." }, { optionId: "far", consideration: "If classmates remain near campus after class, living off campus could make staying connected a more deliberate part of your routine." }] },
    { id: "privacy", type: "consideration", name: "Privacy and personal space", group: "Personal priorities", description: "Explore sharing space and creating boundaries, without assuming either housing option guarantees privacy.", targets: [{ optionId: "near", consideration: "If common areas or rooms are shared, daily contact could bring interruptions as well as company, depending on the actual setup." }, { optionId: "far", consideration: "If the off-campus arrangement offers space of your own, you could build a separate routine; shared housing could still require boundaries." }] },
    { id: "independence", type: "consideration", name: "Managing your own home", group: "Personal priorities", description: "Explore autonomy and responsibility in the place you live.", targets: [{ optionId: "near", consideration: "If housing staff handle some building tasks, campus living could leave you following shared rules while getting help with those responsibilities." }, { optionId: "far", consideration: "If you handle landlord communication and household decisions yourself, off-campus living could involve more choices and follow-through." }] },
  ],
};
