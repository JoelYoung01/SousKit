import { startOfDay } from "../dates";
import * as sse from "../../api/sse";
import { streamCommitWizard, streamCommitWizardNights } from "../../api/wizard";
import {
  buildCommitNightsPayload,
  buildWizardWeeks,
  draftFromBuiltRecipe,
  draftFromExistingRecipe,
  requiredWeekCountForDays,
  type DraftNightEntry
} from "../wizard";

describe("buildWizardWeeks", () => {
  it("loads at least 2 weeks (this week and next week) by default", () => {
    const today = startOfDay(new Date(2026, 9, 23)); // Friday Oct 23, 2026
    const weeks = buildWizardWeeks(today, 2);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]?.label).toBe("This week");
    expect(weeks[0]?.dayKeys).toHaveLength(7);
    expect(weeks[0]?.dayKeys[0]).toBe("2026-10-19");
    expect(weeks[1]?.label).toBe("Next week");
    expect(weeks[1]?.dayKeys[0]).toBe("2026-10-26");
  });

  it("mounts additional weeks dynamically as weekCount grows", () => {
    const today = startOfDay(new Date(2026, 9, 23));
    const weeks = buildWizardWeeks(today, 4);
    expect(weeks).toHaveLength(4);
    expect(weeks[2]?.dayKeys[0]).toBe("2026-11-02");
    expect(weeks[3]?.dayKeys[0]).toBe("2026-11-09");
  });
});

describe("requiredWeekCountForDays", () => {
  it("returns 2 when no query days or days within first two weeks", () => {
    const today = startOfDay(new Date(2026, 9, 23));
    expect(requiredWeekCountForDays(today, [])).toBe(2);
    expect(requiredWeekCountForDays(today, ["2026-10-27"])).toBe(2);
  });

  it("expands week count to cover future queried dates", () => {
    const today = startOfDay(new Date(2026, 9, 23)); // week starts 2026-10-19
    expect(requiredWeekCountForDays(today, ["2026-11-10"])).toBe(4);
  });
});

describe("buildCommitNightsPayload", () => {
  it("includes only selected nights that have a draft recipe, allowing unplanned nights", () => {
    const draftByDay: Record<string, DraftNightEntry> = {
      "2026-10-23": draftFromExistingRecipe({
        id: 42,
        name: "Saved Pasta",
        description: "Quick pasta",
        created_on: "2026-01-01T00:00:00Z",
        created_by_id: 1,
        household_id: 1,
        public: false,
        prep_time: 20
      }),
      "2026-10-25": draftFromBuiltRecipe({
        idea_id: "idea-1",
        title: "Generated Tacos",
        description: "Crispy tacos",
        instructions: "1. Cook.\n2. Serve.",
        prep_time: 25,
        ingredients: [{ name: "tortillas", amount: 6, units: "pcs" }],
        source: "generated"
      }),
      // Deselected night kept in draftByDay (non-destructive back) should not be committed if unselected
      "2026-10-27": draftFromExistingRecipe({
        id: 99,
        name: "Deselected Soup",
        description: "",
        created_on: "2026-01-01T00:00:00Z",
        created_by_id: 1,
        household_id: 1,
        public: false
      })
    };

    const payload = buildCommitNightsPayload(
      ["2026-10-23", "2026-10-24", "2026-10-25"],
      draftByDay
    );

    expect(payload).toHaveLength(2);
    expect(payload[0]).toEqual({ day: "2026-10-23", recipe_id: 42 });
    expect(payload[1]?.day).toBe("2026-10-25");
    expect(payload[1]?.built_recipe?.title).toBe("Generated Tacos");
  });
});

describe("streamCommitWizardNights & streamCommitWizard", () => {
  it("streams commit events from /meal-plan-wizard/commit-plan-stream/ and /sessions/:id/commit-stream/", async () => {
    const spy = jest.spyOn(sse, "postSse").mockResolvedValue(undefined);
    const onEvent = jest.fn();

    await streamCommitWizardNights([{ day: "2026-10-25", recipe_id: 42 }], onEvent);
    expect(spy).toHaveBeenCalledWith(
      "/meal-plan-wizard/commit-plan-stream/",
      { nights: [{ day: "2026-10-25", recipe_id: 42 }] },
      onEvent,
      undefined
    );

    await streamCommitWizard("sess-123", { plan: false }, onEvent);
    expect(spy).toHaveBeenCalledWith(
      "/meal-plan-wizard/sessions/sess-123/commit-stream/",
      { plan: false },
      onEvent,
      undefined
    );

    spy.mockRestore();
  });
});

