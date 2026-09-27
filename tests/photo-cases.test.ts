import { describe, expect, it } from "vitest";
import { matchesPhotoExpectation, parsePhotoCases, photoCaseCounts } from "../scripts/lib/photo-cases";

const files = ["book-cover.jpg", "different-edition.heic", "unreadable-cover.png"];
const valid = { cases: [
  { file: files[0], status: "matched", person: "writing-friend", relation: "planned_together" },
  { file: files[1], status: "no_match" },
  { file: files[2], status: "needs_clarification" },
] };

describe("photo cases manifest", () => {
  it("requires explicit expectations for every photo and counts each status", () => {
    const cases = parsePhotoCases(valid, files);
    expect(photoCaseCounts(cases, [
      { file: files[0], pass: true }, { file: files[1], pass: false }, { file: files[2], pass: true },
    ])).toEqual([
      { status: "matched", passed: 1, total: 1 },
      { status: "no_match", passed: 0, total: 1 },
      { status: "needs_clarification", passed: 1, total: 1 },
    ]);
    expect(matchesPhotoExpectation(cases[0], { status: "matched", person: "writing-friend", relation: "planned_together" }, 200)).toBe(true);
    expect(matchesPhotoExpectation(cases[0], { status: "matched", person: "writing-friend", relation: "planned_together" }, 503)).toBe(false);
    expect(matchesPhotoExpectation(cases[2], { status: "needs_clarification" }, 200)).toBe(true);
  });

  it("rejects path traversal and missing matched expectations", () => {
    expect(() => parsePhotoCases({ cases: [{ file: "../book-cover.jpg", status: "no_match" }] }, files)).toThrow(/inside the photo folder/);
    expect(() => parsePhotoCases({ cases: [{ file: "..\\book-cover.jpg", status: "no_match" }] }, files)).toThrow(/inside the photo folder/);
    expect(() => parsePhotoCases({ cases: [{ file: files[0], status: "matched" }] }, [files[0]])).toThrow(/needs person and relation/);
  });

  it("rejects duplicate, missing, and unlabeled photos", () => {
    expect(() => parsePhotoCases({ cases: [{ file: files[0], status: "no_match" }, { file: files[0], status: "no_match" }] }, [files[0]])).toThrow(/Duplicate/);
    expect(() => parsePhotoCases({ cases: [{ file: "absent.jpg", status: "no_match" }] }, files)).toThrow(/missing photo/);
    expect(() => parsePhotoCases({ cases: [{ file: files[0], status: "no_match" }] }, files)).toThrow(/Unlabeled/);
  });
});
