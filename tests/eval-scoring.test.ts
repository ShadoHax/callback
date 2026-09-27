import { describe, expect, it } from "vitest";
import { scoreCase, summarize, type Expectation, type Prediction } from "../src/lib/eval-scoring";

const valid = new Set(["s1", "s2", "s3"]);
const match = (personId: string, sourceIds: string[], relation = "asked_to_find"): Prediction => ({ status: "matched", personId, relation, sourceIds, ms: 4000 });
const abstain = (status: "no_match" | "needs_clarification"): Prediction => ({ status, personId: "", relation: "", sourceIds: [], ms: 3000 });
const hero: Expectation = { status: "matched", personId: "maya", relation: "asked_to_find", supportIds: ["s1"] };

describe("scoreCase", () => {
  it("credits a right person, relation, and acceptable evidence", () => {
    expect(scoreCase(hero, match("maya", ["s1"]), valid)).toMatchObject({ statusCorrect: true, personCorrect: true, relationCorrect: true, supportValid: true, evidenceCorrect: true, unsupportedClaim: false });
  });

  it("treats an empty citation list as unsupported, not vacuously valid", () => {
    expect(scoreCase(hero, match("maya", []), valid)).toMatchObject({ personCorrect: true, supportValid: false, evidenceCorrect: false, unsupportedClaim: true });
  });

  it("treats a citation outside the case corpus as unsupported", () => {
    expect(scoreCase(hero, match("maya", ["s1", "ghost"]), valid)).toMatchObject({ supportValid: false, unsupportedClaim: true });
  });

  it("separates the right person with the wrong relation or evidence", () => {
    expect(scoreCase(hero, match("maya", ["s2"], "wanted"), valid)).toMatchObject({ personCorrect: true, relationCorrect: false, evidenceCorrect: false, unsupportedClaim: false });
  });

  it("does not count clarification as a correct no-match, or the reverse", () => {
    expect(scoreCase({ status: "no_match" }, abstain("needs_clarification"), valid).statusCorrect).toBe(false);
    expect(scoreCase({ status: "needs_clarification" }, abstain("no_match"), valid).statusCorrect).toBe(false);
  });

  it("marks operational errors separately and never as unsupported claims", () => {
    expect(scoreCase(hero, { ...abstain("no_match"), error: "timeout" }, valid)).toMatchObject({ error: true, unsupportedClaim: false, personCorrect: false });
  });
});

describe("summarize", () => {
  it("reports each metric with its own denominator and excludes errors from accuracy", () => {
    const rows = [
      { expect: hero, prediction: match("maya", ["s1"]) },
      { expect: hero, prediction: match("noah", ["s3"]) },
      { expect: { status: "no_match" } as Expectation, prediction: abstain("no_match") },
      { expect: { status: "needs_clarification" } as Expectation, prediction: abstain("no_match") },
      { expect: { status: "no_match" } as Expectation, prediction: match("priya", ["s2"]) },
      { expect: hero, prediction: { ...abstain("no_match"), error: "timeout" } },
    ].map((row) => ({ ...row, score: scoreCase(row.expect, row.prediction, valid) }));
    const summary = summarize(rows);
    expect(summary).toMatchObject({
      cases: 6, errors: 1, statusAccuracy: [3, 5], personPrecision: [1, 3], personCoverage: [1, 3], relationCorrect: [1, 3], evidenceCorrect: [1, 3],
      unsupportedClaims: [2, 3], noMatchCorrect: [1, 2], clarificationCorrect: [0, 1], abstainedOnNonMatch: [2, 3],
    });
  });
});
