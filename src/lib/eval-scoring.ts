// Pure scoring for scripts/evaluate.ts. Each metric says exactly what it checks; the one-sentence reason text is
// never auto-judged. Operational errors are counted separately and excluded from accuracy denominators.

export type Status = "matched" | "needs_clarification" | "no_match";
export type Expectation = { status: Status; personId?: string; relation?: string; supportIds?: string[] };
export type Prediction = { status: Status; personId: string; relation: string; sourceIds: string[]; ms: number; error?: string };

export type CaseScore = {
  error: boolean;
  statusCorrect: boolean;
  personCorrect: boolean | null;      // expected match only: predicted a match with the labeled person
  relationCorrect: boolean | null;    // expected match with a relation label: right person and relation
  supportValid: boolean | null;       // predicted match only: nonempty citations that all exist in the case corpus
  evidenceCorrect: boolean | null;    // expected match with acceptable support: right person, valid support, cites an acceptable source
  unsupportedClaim: boolean;          // predicted match that is wrong, for someone else, or without valid support
};

export function scoreCase(expect: Expectation, prediction: Prediction, validIds: Set<string>): CaseScore {
  if (prediction.error) return { error: true, statusCorrect: false, personCorrect: expect.status === "matched" ? false : null, relationCorrect: expect.status === "matched" && expect.relation ? false : null, supportValid: null, evidenceCorrect: expect.status === "matched" && expect.supportIds?.length ? false : null, unsupportedClaim: false };
  const predictedMatch = prediction.status === "matched";
  const supportValid = predictedMatch ? prediction.sourceIds.length > 0 && prediction.sourceIds.every((id) => validIds.has(id)) : null;
  const personCorrect = expect.status === "matched" ? predictedMatch && prediction.personId === expect.personId : null;
  const relationCorrect = expect.status === "matched" && expect.relation ? Boolean(personCorrect) && prediction.relation === expect.relation : null;
  const evidenceCorrect = expect.status === "matched" && expect.supportIds?.length ? Boolean(personCorrect) && Boolean(supportValid) && prediction.sourceIds.some((id) => expect.supportIds!.includes(id)) : null;
  const unsupportedClaim = predictedMatch && (expect.status !== "matched" || !personCorrect || !supportValid);
  return { error: false, statusCorrect: prediction.status === expect.status, personCorrect, relationCorrect, supportValid, evidenceCorrect, unsupportedClaim };
}

type Fraction = [number, number];
export type Summary = {
  cases: number; errors: number;
  statusAccuracy: Fraction; personPrecision: Fraction; personCoverage: Fraction; relationCorrect: Fraction; evidenceCorrect: Fraction;
  unsupportedClaims: Fraction; noMatchCorrect: Fraction; clarificationCorrect: Fraction; abstainedOnNonMatch: Fraction;
  p50Ms: number | null; p95Ms: number | null;
};

const percentile = (values: number[], p: number) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]; };
const count = <T>(items: T[], test: (item: T) => boolean): number => items.filter(test).length;

export function summarize(rows: { expect: Expectation; prediction: Prediction; score: CaseScore }[]): Summary {
  const ok = rows.filter((row) => !row.score.error);
  const predictedMatches = ok.filter((row) => row.prediction.status === "matched");
  const expectedMatches = rows.filter((row) => row.expect.status === "matched");
  const withRelation = expectedMatches.filter((row) => row.expect.relation);
  const withSupport = expectedMatches.filter((row) => row.expect.supportIds?.length);
  const noMatch = ok.filter((row) => row.expect.status === "no_match");
  const clarify = ok.filter((row) => row.expect.status === "needs_clarification");
  const nonMatch = ok.filter((row) => row.expect.status !== "matched");
  const times = ok.map((row) => row.prediction.ms).filter((ms) => Number.isFinite(ms));
  return {
    cases: rows.length, errors: rows.length - ok.length,
    statusAccuracy: [count(ok, (row) => row.score.statusCorrect), ok.length],
    personPrecision: [count(predictedMatches, (row) => row.score.personCorrect === true && row.score.supportValid === true), predictedMatches.length],
    personCoverage: [count(expectedMatches, (row) => row.score.personCorrect === true), expectedMatches.length],
    relationCorrect: [count(withRelation, (row) => row.score.relationCorrect === true), withRelation.length],
    evidenceCorrect: [count(withSupport, (row) => row.score.evidenceCorrect === true), withSupport.length],
    unsupportedClaims: [count(predictedMatches, (row) => row.score.unsupportedClaim), predictedMatches.length],
    noMatchCorrect: [count(noMatch, (row) => row.prediction.status === "no_match"), noMatch.length],
    clarificationCorrect: [count(clarify, (row) => row.prediction.status === "needs_clarification"), clarify.length],
    abstainedOnNonMatch: [count(nonMatch, (row) => row.prediction.status !== "matched"), nonMatch.length],
    p50Ms: percentile(times, 50), p95Ms: percentile(times, 95),
  };
}

export const fraction = ([n, d]: Fraction) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "n/a (0 labeled)");
