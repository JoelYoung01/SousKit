import type {
  MealPlanWizardPrefs,
  MealPlanWizardProgressEvent,
  MealPlanWizardSession,
  MealPlanWizardStep,
  PlannedRecipeDetail
} from "@/types";
import { get, patch, post } from "./client";
import { postSse, type SseHandler } from "./sse";

export function createWizardSession(
  days: string[],
  prefs: MealPlanWizardPrefs
): Promise<MealPlanWizardSession> {
  return post<MealPlanWizardSession>("/meal-plan-wizard/sessions/", { days, prefs });
}

export function fetchWizardSession(sessionId: string): Promise<MealPlanWizardSession> {
  return get<MealPlanWizardSession>(`/meal-plan-wizard/sessions/${sessionId}/`);
}

export function updateWizardDays(
  sessionId: string,
  days: string[]
): Promise<MealPlanWizardSession> {
  return patch<MealPlanWizardSession>(`/meal-plan-wizard/sessions/${sessionId}/days/`, { days });
}

export function updateWizardPrefs(
  sessionId: string,
  prefs: MealPlanWizardPrefs
): Promise<MealPlanWizardSession> {
  return patch<MealPlanWizardSession>(`/meal-plan-wizard/sessions/${sessionId}/prefs/`, prefs);
}

export function selectWizardIdeas(
  sessionId: string,
  ideaIds: string[]
): Promise<MealPlanWizardSession> {
  return post<MealPlanWizardSession>(`/meal-plan-wizard/sessions/${sessionId}/select/`, {
    idea_ids: ideaIds
  });
}

export function rewindWizard(
  sessionId: string,
  toStep: MealPlanWizardStep
): Promise<MealPlanWizardSession> {
  return post<MealPlanWizardSession>(`/meal-plan-wizard/sessions/${sessionId}/rewind/`, {
    to_step: toStep
  });
}

export function commitWizard(
  sessionId: string,
  opts?: { plan?: boolean }
): Promise<PlannedRecipeDetail[]> {
  return post<PlannedRecipeDetail[]>(`/meal-plan-wizard/sessions/${sessionId}/commit/`, {
    plan: opts?.plan ?? true
  });
}

/** Streamed ideation — emits progress events until the stream closes. */
export function streamIdeate(
  sessionId: string,
  refinement: string | null,
  onEvent: SseHandler<MealPlanWizardProgressEvent>,
  signal?: AbortSignal
): Promise<void> {
  return postSse(`/meal-plan-wizard/sessions/${sessionId}/ideate/`, { refinement }, onEvent, signal);
}

/** Streamed recipe build — emits progress events until the stream closes. */
export function streamBuild(
  sessionId: string,
  body: { refinement: string | null; idea_ids: string[] | null },
  onEvent: SseHandler<MealPlanWizardProgressEvent>,
  signal?: AbortSignal
): Promise<void> {
  return postSse(`/meal-plan-wizard/sessions/${sessionId}/build/`, body, onEvent, signal);
}

/** Streamed freeform build — skips ideate/select; builds from a single prompt. */
export function streamFreeformBuild(
  sessionId: string,
  body: { prompt: string; refinement: string | null; idea_ids: string[] | null },
  onEvent: SseHandler<MealPlanWizardProgressEvent>,
  signal?: AbortSignal
): Promise<void> {
  return postSse(
    `/meal-plan-wizard/sessions/${sessionId}/build-freeform/`,
    body,
    onEvent,
    signal
  );
}
