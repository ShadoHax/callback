import { expect, it } from "vitest";
import { runSummary } from "../scripts/lib/live";

it("separates total complete runs from the longest consecutive streak", () => {
  const runs = [true, true, false, true, true, true, false].map((ok) => ({ ok }));
  expect(runSummary(runs)).toEqual({ complete: 5, longest: 3, trailing: 0 });
});

it("counts a run with any failed assertion as incomplete", () => {
  const failures = [[], ["recipient can open the shared photo"], []];
  expect(runSummary(failures.map((list) => ({ ok: list.length === 0 })))).toEqual({ complete: 2, longest: 1, trailing: 1 });
});
