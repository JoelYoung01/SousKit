import {
  copyPreviousButtonLabel,
  indexMealsByDay,
  lookbackWindow,
  mealCopySummary,
  selectionLookbackWindow
} from "../duplicateMealPlan";

/** Monday Nov 2 through Sunday Nov 8, 2026 — the week after Friday Oct 30. */
const NEXT_WEEK = [
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07",
  "2026-11-08"
];

describe("selectionLookbackWindow", () => {
  it("copies the previous Monday–Sunday onto next week", () => {
    const window = selectionLookbackWindow(NEXT_WEEK);
    expect(window).not.toBeNull();
    expect(window?.spanDays).toBe(7);
    expect(window?.sourceStart).toBe("2026-10-26");
    expect(window?.sourceEnd).toBe("2026-11-01");
    expect(window?.pairs.map((pair) => [pair.targetKey, pair.sourceKey])).toEqual([
      ["2026-11-02", "2026-10-26"],
      ["2026-11-03", "2026-10-27"],
      ["2026-11-04", "2026-10-28"],
      ["2026-11-05", "2026-10-29"],
      ["2026-11-06", "2026-10-30"],
      ["2026-11-07", "2026-10-31"],
      ["2026-11-08", "2026-11-01"]
    ]);
  });

  it("copies the 7 days before a Saturday–Friday run", () => {
    const days = [
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06"
    ];
    const window = selectionLookbackWindow(days);
    expect(window?.spanDays).toBe(7);
    expect(window?.pairs[0]).toEqual({ targetKey: "2026-10-31", sourceKey: "2026-10-24" });
    expect(window?.pairs[6]).toEqual({ targetKey: "2026-11-06", sourceKey: "2026-10-30" });
  });

  it("uses the calendar span when nights are skipped, not the count of checked nights", () => {
    const window = selectionLookbackWindow(["2026-11-06", "2026-11-02", "2026-11-04"]);
    expect(window?.spanDays).toBe(5);
    expect(window?.pairs).toEqual([
      { targetKey: "2026-11-02", sourceKey: "2026-10-28" },
      { targetKey: "2026-11-04", sourceKey: "2026-10-30" },
      { targetKey: "2026-11-06", sourceKey: "2026-11-01" }
    ]);
  });

  it("returns null when nothing valid is selected", () => {
    expect(selectionLookbackWindow([])).toBeNull();
    expect(selectionLookbackWindow(["nope"])).toBeNull();
  });

  it("drops duplicate and invalid keys", () => {
    const window = selectionLookbackWindow(["2026-11-02", "2026-11-02", "bad"]);
    expect(window?.spanDays).toBe(1);
    expect(window?.pairs).toEqual([{ targetKey: "2026-11-02", sourceKey: "2026-11-01" }]);
  });
});

describe("lookbackWindow", () => {
  it("keeps weekday alignment for the rest of this week by looking back 7 days", () => {
    const window = lookbackWindow(["2026-10-30", "2026-10-31", "2026-11-01"], 7);
    expect(window?.spanDays).toBe(7);
    expect(window?.pairs).toEqual([
      { targetKey: "2026-10-30", sourceKey: "2026-10-23" },
      { targetKey: "2026-10-31", sourceKey: "2026-10-24" },
      { targetKey: "2026-11-01", sourceKey: "2026-10-25" }
    ]);
  });

  it("rejects a non-positive span", () => {
    expect(lookbackWindow(NEXT_WEEK, 0)).toBeNull();
    expect(lookbackWindow(NEXT_WEEK, -7)).toBeNull();
  });
});

describe("copy labels", () => {
  it("names a single day differently from a stretch", () => {
    expect(copyPreviousButtonLabel(1)).toBe("Copy previous day");
    expect(copyPreviousButtonLabel(7)).toBe("Copy previous 7 days");
  });

  it("describes a week copy and a custom selection separately", () => {
    const week = selectionLookbackWindow(NEXT_WEEK)!;
    expect(mealCopySummary(week, "Next week")).toContain("Copy last week onto Next week");
    expect(mealCopySummary(week)).toContain("Copy the 7 days just before these 7 nights");
  });
});

describe("indexMealsByDay", () => {
  it("keeps the earliest dinner on a night and records the rest", () => {
    const indexed = indexMealsByDay([
      {
        id: 9,
        plannedFor: "2026-10-26T17:00:00.000Z",
        recipeId: 4,
        title: "Later plate"
      },
      {
        id: 2,
        plannedFor: "2026-10-26",
        recipeId: 1,
        title: "  Chicken tikka  ",
        description: "Weeknight",
        prepTime: 40,
        coverUrl: "/covers/1.jpg"
      }
    ]);
    expect(indexed["2026-10-26"]).toEqual({
      recipeId: 1,
      title: "Chicken tikka",
      description: "Weeknight",
      prepTime: 40,
      coverUrl: "/covers/1.jpg",
      extraTitles: ["Later plate"]
    });
  });

  it("ignores meals with no recipe or title", () => {
    expect(
      indexMealsByDay([
        { plannedFor: "2026-10-26", recipeId: 0, title: "Nope" },
        { plannedFor: "not-a-date", recipeId: 1, title: "Nope" },
        { plannedFor: "2026-10-27", recipeId: 3, title: "   " }
      ])
    ).toEqual({});
  });
});
