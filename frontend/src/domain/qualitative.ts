import type { Decision } from "./types";

export function isQualitativeDecision(decision: Decision): boolean {
  return decision.schemaVersion === 2 && decision.comparisonMode === "qualitative";
}

export function buildQualitativeStoryFacts(decision: Decision): Record<string, string> {
  return { optionA_name: decision.options[0].name, optionB_name: decision.options[1].name };
}

export const qualitativeDemoDecision: Decision = {
  schemaVersion: 2,
  comparisonMode: "qualitative",
  id: "laptop-choice-demo",
  title: "A gaming laptop or an office laptop?",
  description: "An illustrative comparison of how either laptop could fit your routines and priorities. No specific models or specifications are assumed.",
  originalInput: "Should I buy a gaming laptop or an office laptop for the next stage of my work and leisure?",
  currency: "USD",
  options: [
    { id: "gaming", name: "Gaming laptop", fixedCosts: [], activities: [] },
    { id: "office", name: "Office laptop", fixedCosts: [], activities: [] },
  ],
  tags: [
    {
      id: "gaming-time", type: "consideration", name: "Gaming in your free time", group: "Daily use",
      description: "Include leisure gaming in the situations explored by both stories.",
      targets: [
        { optionId: "gaming", consideration: "If the selected model supports your games, work and leisure could share this device. Specific game compatibility still needs checking." },
        { optionId: "office", consideration: "If gaming remains part of your routine, consider whether the selected office model supports your games. Its performance has not been established." },
      ],
    },
    {
      id: "working-away", type: "consideration", name: "Working away from home", group: "Daily use",
      description: "Explore using the laptop in different work settings without assuming weight or battery life.",
      targets: [
        { optionId: "gaming", consideration: "If you carry the gaming laptop between work settings, its actual weight, charger and battery life would become practical considerations." },
        { optionId: "office", consideration: "If you carry the office laptop between work settings, check that its actual portability and unplugged use fit that routine." },
      ],
    },
    {
      id: "work-boundaries", type: "consideration", name: "Keeping work and leisure separate", group: "Personal priorities",
      description: "Explore the boundaries you would like to set around the device, without predicting focus or productivity.",
      targets: [
        { optionId: "gaming", consideration: "If this device serves both work and gaming, consider the routines or boundaries you would choose around those uses." },
        { optionId: "office", consideration: "If you intend this device primarily for work, consider how that intended role fits your existing leisure routine." },
      ],
    },
  ],
};
