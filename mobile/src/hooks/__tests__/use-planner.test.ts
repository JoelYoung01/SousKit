import type { PlannedRecipeDetail, UserResponse } from "@/types";
import { groupPlansByDay, planDayKey } from "../use-planner";

const user: UserResponse = {
  id: 1,
  username: "test@example.com",
  email: "test@example.com",
  display_name: "Test",
  admin: false,
  disabled: false,
  email_verified: true
};

function plan(id: number, plannedFor: string): PlannedRecipeDetail {
  return {
    id,
    created_by_id: user.id,
    household_id: 1,
    created_on: "2026-01-01T00:00:00",
    planned_for: plannedFor,
    created_by: user,
    recipe: {
      id,
      slug: `recipe-${id}`,
      name: `Recipe ${id}`,
      description: "",
      created_on: "2026-01-01T00:00:00",
      updated_on: "2026-01-01T00:00:00",
      created_by_id: user.id,
      household_id: 1,
      public: false,
      head_version_number: 1
    }
  };
}

describe("planDayKey", () => {
  it("slices the local date from an ISO datetime", () => {
    expect(planDayKey(plan(1, "2026-07-30T00:00:00"))).toBe("2026-07-30");
  });
});

describe("groupPlansByDay", () => {
  it("groups multiple plans on the same day", () => {
    const grouped = groupPlansByDay([
      plan(1, "2026-07-30T00:00:00"),
      plan(2, "2026-07-30T00:00:00"),
      plan(3, "2026-07-31T00:00:00")
    ]);
    expect(grouped.get("2026-07-30")?.map((p) => p.id)).toEqual([1, 2]);
    expect(grouped.get("2026-07-31")?.map((p) => p.id)).toEqual([3]);
  });

  it("returns an empty map for undefined input", () => {
    expect(groupPlansByDay(undefined).size).toBe(0);
  });
});
