import { addDays, startOfDay, toDateKey } from "@/lib/dates";
import {
  PLAN_DAY_COUNT,
  buildPlanDays,
  formatQuotedList,
  planCommit,
  planWhenLabel,
  plannedSummary,
  replacePrompt
} from "../planDay";

/** Thursday, Nov 5, 2026 — local calendar date. */
const TODAY = new Date(2026, 10, 5);

describe("buildPlanDays", () => {
  it("offers tonight, tomorrow, then weekdays, and attaches meals by date key", () => {
    const friday = addDays(startOfDay(TODAY), 2);
    const days = buildPlanDays(TODAY, [
      {
        id: 1,
        planned_for: "2026-11-05T18:00:00",
        recipe: { id: 10, name: "Tacos" }
      },
      {
        id: 2,
        planned_for: "2026-11-06T17:00:00.000Z",
        recipe: { id: 11, name: "Chili" }
      },
      {
        id: 3,
        planned_for: `${toDateKey(friday)}T12:00:00`,
        recipe: { id: 12, name: "Soup" }
      },
      {
        id: 4,
        planned_for: `${toDateKey(friday)}T19:00:00`,
        recipe: { id: 13, name: "Salad" }
      }
    ]);

    expect(days).toHaveLength(PLAN_DAY_COUNT);
    expect(days[0]).toMatchObject({
      key: "2026-11-05",
      label: "Tonight",
      planned: [{ id: 1, recipe: { name: "Tacos" } }]
    });
    expect(days[1]).toMatchObject({
      key: "2026-11-06",
      label: "Tomorrow",
      planned: [{ id: 2, recipe: { name: "Chili" } }]
    });
    expect(days[2]?.label).toBe(friday.toLocaleDateString(undefined, { weekday: "long" }));
    expect(days[2]?.planned.map((meal) => meal.recipe.name)).toEqual(["Soup", "Salad"]);
    expect(days[3]?.planned).toEqual([]);
  });
});

describe("planCommit", () => {
  const tacos = { id: 1, recipe: { id: 10, name: "Tacos" } };
  const same = { id: 2, recipe: { id: 7, name: "Pasta" } };

  it("assigns an open night", () => {
    expect(planCommit(7, [])).toEqual({ kind: "assign" });
  });

  it("treats a night that is already this recipe as planned", () => {
    expect(planCommit(7, [same])).toEqual({ kind: "already" });
  });

  it("asks to replace a different recipe, including when this recipe is also there", () => {
    expect(planCommit(7, [tacos])).toEqual({ kind: "replace", others: [tacos] });
    expect(planCommit(7, [same, tacos])).toEqual({ kind: "replace", others: [tacos] });
  });
});

describe("plan copy", () => {
  it("summarizes the first meal and a count of the rest", () => {
    expect(plannedSummary([])).toBeNull();
    expect(plannedSummary([{ id: 1, recipe: { id: 1, name: "Tacos" } }])).toBe("Tacos");
    expect(
      plannedSummary([
        { id: 1, recipe: { id: 1, name: "Tacos" } },
        { id: 2, recipe: { id: 2, name: "Chili" } }
      ])
    ).toBe("Tacos +1");
  });

  it("quotes one, two, and many names", () => {
    expect(formatQuotedList(["Tacos"])).toBe("“Tacos”");
    expect(formatQuotedList(["Tacos", "Chili"])).toBe("“Tacos” and “Chili”");
    expect(formatQuotedList(["Tacos", "Chili", "Salad"])).toBe("“Tacos”, “Chili”, and “Salad”");
  });

  it("names tonight and a later weekday in the replace prompt", () => {
    expect(planWhenLabel({ label: "Tonight", dateLabel: "Nov 5" })).toBe("tonight");
    expect(
      replacePrompt("Pasta", { label: "Tonight", dateLabel: "Nov 5" }, ["Tacos"])
    ).toBe("Tonight already has “Tacos”. Replace it with “Pasta”?");
    expect(
      replacePrompt("Pasta", { label: "Friday", dateLabel: "Nov 7" }, ["Tacos", "Chili"])
    ).toBe("Friday, Nov 7 already has “Tacos” and “Chili”. Replace them with “Pasta”?");
  });
});
