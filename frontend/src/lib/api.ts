import type { Decision, CalculationResult } from "../domain";

export type StoryMode = "general" | "campus" | "qualitative";
export type StoryContext = {
  mode: StoryMode;
  arrivalTime?: string;
  departureTime?: string;
  selections?: Array<{ optionId: string; activityId: string; outboundChoiceId: string; inboundChoiceId: string }>;
};

export type Story = {
  decisionId: string;
  mode?: StoryMode;
  simulationVersion: number;
  sharedScenario: { title: string; description: string };
  moments: Array<{
    key: "morning" | "daytime" | "evening" | "beginning" | "during" | "later";
    options: Array<{ optionId: string; text: string }>;
  }>;
  monthlyReflections: Array<{ optionId: string; text: string }>;
  advice?: Array<{ optionId: string; text: string }>;
};

export type StoryRequest = {
  snapshot: {
    decision: Decision;
    enabledTagIds: string[];
    simulationVersion: number;
    calculation: CalculationResult;
  };
  context: StoryContext;
  facts: Record<string, string>;
};

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("The local service is unavailable. Start the backend and try again.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "message" in payload && typeof payload.message === "string"
      ? payload.message
      : `Request failed (${response.status}). Please try again.`;
    throw new Error(message);
  }
  return payload as T;
}

export function generateScenario(description: string, signal?: AbortSignal) {
  return postJson<Decision>("/api/scenarios/generate", { description }, signal);
}

export function generateStory(request: StoryRequest, signal?: AbortSignal) {
  return postJson<Story>("/api/stories/generate", request, signal);
}
