import { usesLongTermStory, type CalculationResult, type CampusDaySchedule, type Decision } from "../domain";
import type { Story } from "../lib/api";
import { importanceLabel } from "./ui";

type Factor = Extract<Decision["tags"][number], { type: "consideration" }>;
const stages = ["beginning", "during", "later"] as const;

function factorsFor(decision: Decision, enabledTagIds: string[], optionId: string): Factor[] {
  return decision.tags.filter((tag): tag is Factor => tag.type === "consideration" && enabledTagIds.includes(tag.id) && tag.targets.some((target) => target.optionId === optionId))
    .sort((first, second) => (second.importance ?? 0) - (first.importance ?? 0));
}

function focusSentence(factors: Factor[]): string {
  if (!factors.length) return "";
  const priority = factors[0].importance === undefined ? "" : `, which you marked ${importanceLabel(factors[0].importance)}`;
  return ` The scene centers on “${factors[0].name}”${priority}.`;
}

function nextAction(decision: Decision, optionIndex: number, factors: Factor[], campus = false): string {
  const name = decision.options[optionIndex].name;
  if (decision.comparisonMode === "subscription") return `Before paying for ${name}, obtain the billing, renewal and cancellation terms in writing. Compare the entered price over a window that matches a period you want to explore; a lower displayed total does not establish the plan's flexibility.`;
  if (decision.id === "laptop-choice-demo") return optionIndex === 0
    ? "Try your actual work software and games on the specific gaming model before committing. If you expect to carry it, include its charger in a hands-on portability check."
    : "Try your actual work software on the specific office model, then test any leisure use you want the same device to support. Base the purchase on those results rather than the category name.";
  if (decision.id === "coffee-break-even-demo") return optionIndex === 0
    ? "Try the preparation and cleanup routine before buying. Replace the example machine and ingredient prices with the costs of the setup you would actually use."
    : "Use the price of the drink you actually order in the comparison. Compare a realistic number of cups while keeping the convenience of buying coffee as a separate priority.";
  if (campus) return `Try the route for ${name} under the shared arrival and departure setting, then replace any example travel values with your observations before committing to housing.`;
  return factors.length
    ? `Before committing to ${name}, try a small, reversible version of the situation behind “${factors[0].name}”. Use what you observe to revisit this path and its assumptions.`
    : `Before committing to ${name}, try a small, reversible version of the choice and verify the assumptions most likely to change your decision.`;
}

function laptopScenes(index: number, selected: Factor[]): [string, string, string] {
  const name = index === 0 ? "{{optionA_name}}" : "{{optionB_name}}";
  const has = (id: string) => selected.some((factor) => factor.id === id);
  const scene = selected[0]?.id;
  const during = scene === "working-away"
    ? `For an imagined working session away from your usual desk, you pack ${name} and its charger. The same work now happens in a different setting; the actual model's weight and unplugged operation would shape that experience.`
    : scene === "gaming-time"
      ? `When work is finished, you open a game on ${name}. If this particular model supports it, the same device carries you into your leisure time. The category alone does not tell us how that game will run.`
      : scene === "work-boundaries"
        ? `Your work session ends and you close the work files on ${name}. In this version of the day, you keep the boundary you selected by deliberately ending that session before moving to leisure.`
        : `An ordinary work session begins on ${name}: your files are open and the task in front of you is the same in either path. How smoothly it runs depends on the actual model and software.`;
  return [
    `Imagine setting ${name} on your desk and opening the work you normally do. This is the device at the center of the next stage of your routine; no performance or battery specification is assumed.`,
    during + focusSentence(selected),
    `Later, you return to the same device for another work session.${has("work-boundaries") ? " Closing and reopening the work files has become the visible boundary in this imagined routine." : has("working-away") ? " The setup includes both the usual desk and the away-from-home sessions you selected." : has("gaming-time") ? " Work and compatible leisure use share the device in this imagined routine." : " The choice remains part of your daily setup, with its fit becoming clearer through actual use."}`,
  ];
}

function subscriptionScene(decision: Decision, optionIndex: number, selected: Factor[], fallback: string): string {
  if (decision.id !== "annual-monthly-demo" || !selected.length) return fallback + focusSentence(selected);
  const annual = decision.options[optionIndex].subscriptionCosts?.periodMonths === 12;
  const scenes: Record<string, [string, string]> = {
    routine: ["In this imagined stretch, you return to the membership as part of an ordinary week. Access is already prepaid, so those returns happen inside the existing billing period.", "In this imagined stretch, you return to the membership as part of an ordinary week. Shorter billing periods punctuate that continuing routine, with a full payment at each renewal included in the window."],
    schedule: ["An imagined week fills with other commitments and you do not use the membership during that stretch. The prepaid period keeps running in this comparison, with access still paid for even while your routine is elsewhere.", "An imagined week fills with other commitments and you do not use the membership during that stretch. A coming billing boundary brings the next decision into view, although the right to stop or pause still depends on the actual terms."],
    "upfront-budget": ["You look at the money available just after paying for the longer period. The full payment has gone out together; the remaining choices in this imagined budget start after that outlay.", "You look at the money available just after the current payment. Only this billing period has been paid for at that point, while later periods bring their own full charges."],
    "changing-needs": ["After getting started, the experience feels different from what you imagined. In this possible path, some of the longer prepaid period still lies ahead while you work out whether the membership fits.", "After getting started, the experience feels different from what you imagined. In this possible path, the next shorter billing period becomes a point to revisit the arrangement, subject to the actual terms."],
    relocation: ["Imagine packing for a move while some prepaid access remains. The membership is still on the payment record, but using it from the new location would depend on where and how that access works.", "Imagine packing for the same move as another renewal approaches. The membership is still part of the current arrangement; changing it would depend on notice and renewal terms."],
    renewal: [(decision.comparisonMonths ?? 12) <= 12 ? "The routine continues inside the longer prepaid period. Its next renewal remains ahead of the selected comparison window, a future date within the arrangement rather than another charge already paid." : "The routine has continued through the longer prepaid period. As its renewal boundary arrives within the selected window, another full payment returns to the foreground of this imagined path.", (decision.comparisonMonths ?? 12) === 1 ? "The current billing period is paid for. The next renewal is still ahead of this short comparison window, a coming point in managing the membership." : "A shorter billing period ends and the next one comes into view. In this imagined path, renewal is a recurring part of managing the membership rather than a distant date."],
  };
  return (scenes[selected[0].id]?.[annual ? 0 : 1] ?? fallback) + focusSentence(selected);
}

export function offlineQualitativeStory(decision: Decision, enabledTagIds: string[], version: number, calculation: CalculationResult): Story {
  const paths = decision.options.map((option, index) => {
    const prefix = index === 0 ? "optionA" : "optionB";
    const name = `{{${prefix}_name}}`;
    const selected = factorsFor(decision, enabledTagIds, option.id);
    let scenes: [string, string, string];
    if (decision.id === "laptop-choice-demo") scenes = laptopScenes(index, selected);
    else if (calculation.status === "subscription") {
      const result = calculation.options[index];
      scenes = [
        `Imagine choosing ${name}. The first payment of {{${prefix}_payment}} opens a billing period of {{${prefix}_periodMonths}} months. You begin with that period paid for, before the rest of this imagined routine has unfolded.`,
        subscriptionScene(decision, index, selected, result.paymentCount > 1 ? `A billing period ends while the selected comparison window continues. In this path, ${name} renews at the entered price and another full payment appears.` : `The selected window stays inside the paid billing period for ${name}. There is no new payment within that window; the existing coverage remains in place.`),
        `At the end of the selected {{comparisonMonths}}-month comparison window, you look back at this imagined path. Its modeled payments total {{${prefix}_totalCost}} across {{${prefix}_paymentCount}} payments. The financial record is clear, while how well the routine suited you still depends on the experience itself.`,
      ];
    } else if (decision.id === "coffee-break-even-demo") scenes = index === 0 ? [
      "Imagine placing the coffee machine in your kitchen. The setup begins with {{optionA_upfrontCost}} paid upfront, before the first cup is made.",
      "You make a cup in that kitchen, then put the preparation area back in order. Each cup adds the configured {{optionA_perUseCost}} to this path's cost." + focusSentence(selected),
      "Later, the machine is still the starting point for cups made at home in this imagined routine. {{breakEvenSummary}} The experience of making and cleaning up remains separate from that cost crossover.",
    ] : [
      "Imagine keeping coffee purchases in your routine. This path starts with {{optionB_upfrontCost}} in upfront cost, and each ordered cup carries its own payment.",
      "You collect the cup you ordered and continue with the rest of your day. Each cup adds the configured {{optionB_perUseCost}} to this path's cost." + focusSentence(selected),
      "Later, another coffee purchase follows the same pattern: a cup and a payment. {{breakEvenSummary}} Buying coffee remains a different routine even when the cumulative prices cross.",
    ];
    else scenes = [
      `Imagine the choice has been made and ${name} becomes part of your next stage. The starting circumstances are the same as in the other path.`,
      `An ordinary week brings ${name} into use.${selected.length ? ` The situation behind “${selected[0].name}” becomes the focus of this imagined scene${selected[0].importance === undefined ? "." : `, reflecting your ${importanceLabel(selected[0].importance).toLowerCase()} priority.`}` : " You follow through on the choice within the circumstances you described."} This is an illustrative possibility, with the actual outcome still open.`,
      `Later, you return to the choice with some experience behind you. ${name} has become familiar in this imagined path, and the way it fits your circumstances is more concrete than it was at the start.${calculation.status === "break_even" ? " {{breakEvenSummary}}" : ""}`,
    ];
    return { optionId: option.id, scenes, advice: nextAction(decision, index, selected) };
  });
  return {
    decisionId: decision.id, simulationVersion: version, mode: "qualitative",
    sharedScenario: { title: "Two choices, the same starting point", description: "An offline illustration of both paths at corresponding stages. Scenes use the selected context; they describe possible experiences, not predicted outcomes." },
    moments: stages.map((key, index) => ({ key, options: paths.map((path) => ({ optionId: path.optionId, text: path.scenes[index] })) })),
    monthlyReflections: [],
    advice: paths.map((path) => ({ optionId: path.optionId, text: path.advice })),
  };
}

function campusScene(decision: Decision, optionIndex: number, selected: Factor[]): string {
  if (decision.id !== "campus-housing-mixed-demo" || !selected.length) return focusSentence(selected);
  const scenes: Record<string, [string, string]> = {
    "social-connection": [" Imagine classmates still around the campus common spaces. In this path, home remains part of that nearby campus setting, so an informal encounter could sit close to the ordinary route home.", " Imagine the same classmates still around the campus common spaces. In this path, the trip home creates a boundary between that setting and home, with social contact fitting around the campus part of the day."],
    privacy: [" In a possible shared-space version of this housing, you return to a room or common area used by others too. Everyday boundaries would be part of settling back into that space; the actual room arrangement is not assumed.", " In a possible shared-space version of this housing, you also return to a space where others may be present. If your actual arrangement is more private, this part of the experience changes; the off-campus label alone does not decide it."],
    independence: [" A household responsibility comes into view in this imagined path. If campus housing staff handle it, your next step is through that shared arrangement and its rules, rather than taking over every building task yourself.", " The same household responsibility comes into view in this imagined path. If it falls to you under the actual arrangement, following through with the landlord or household becomes part of managing the home."],
  };
  return (scenes[selected[0].id]?.[optionIndex] ?? "") + focusSentence(selected);
}

export function offlineStory(decision: Decision, version: number, schedule?: CampusDaySchedule, enabledTagIds: string[] = []): Story {
  const paths = decision.options.map((option, index) => {
    const prefix = index === 0 ? "optionA" : "optionB";
    const selected = factorsFor(decision, enabledTagIds, option.id);
    const scenes = schedule ? [
      `You close the door at {{${prefix}_leaveHome}} and take {{${prefix}_outboundMode}}. At {{${prefix}_arriveCampus}}, you reach the shared destination and the campus part of the day begins.`,
      `The campus part of the day stays the same in both paths. You remain there until the shared departure time, so this scene carries the same commitments whichever home you chose.`,
      `At {{${prefix}_leaveCampus}}, you leave using {{${prefix}_inboundMode}}. You reach home at {{${prefix}_arriveHome}} and put down your bag; the journey is complete for this illustrative day.${campusScene(decision, index, selected)}`,
    ] : [
      `The day begins under {{${prefix}_name}}. You start with the activities and recurring commitments in the current configuration.`,
      `During the day, those configured activities become part of your ordinary routine. The shared circumstances remain the same in the other path.${focusSentence(selected)}`,
      `The day closes under {{${prefix}_name}}. This is one scene from the configured routine, while the monthly record below accounts for the full set of activities.`,
    ];
    return { optionId: option.id, scenes, advice: nextAction(decision, index, selected, !!schedule) };
  });
  return {
    decisionId: decision.id, simulationVersion: version,
    sharedScenario: { title: schedule ? "One shared campus day" : "One illustrative day", description: schedule ? "Both paths follow the same campus arrival and departure anchors. These are example trips from the monthly configuration, not a claim that every day follows this pattern." : "An offline illustration using the same circumstances and only the activities in the current configuration." },
    moments: (["morning", "daytime", "evening"] as const).map((key, index) => ({ key, options: paths.map((path) => ({ optionId: path.optionId, text: path.scenes[index] })) })),
    monthlyReflections: decision.options.map((option, index) => ({ optionId: option.id, text: `Across the full month, {{option${index ? "B" : "A"}_name}} totals {{option${index ? "B" : "A"}_monthlyCost}} and {{option${index ? "B" : "A"}_monthlyTime}} of tracked time.` })),
    advice: paths.map((path) => ({ optionId: path.optionId, text: path.advice })),
  };
}

export function createOfflineStory(decision: Decision, enabledTagIds: string[], version: number, calculation: CalculationResult, schedule?: CampusDaySchedule): Story {
  return usesLongTermStory(decision) ? offlineQualitativeStory(decision, enabledTagIds, version, calculation) : offlineStory(decision, version, schedule, enabledTagIds);
}
