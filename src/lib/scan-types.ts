export type Evidence = { id: string; speakerId: string; role?: "match" | "earlier" | "newer" | "caveat" | "support"; shareableQuote?: boolean; text: string; date: string; synthetic: boolean };
export type CaveatItem = { reason: string; message: string; evidence: Evidence[] };
export type AdviceItem = { personId: string; personName: string; basis: "recommended" | "owns" | "tried" | "dislikes"; favorable: boolean; caution: boolean; mention: string; message: string; sourceIds: string[]; recipientId: string | null; evidence: Evidence[] };
export type RuledOutItem = { personId: string; personName: string; code: string; message: string; evidence: Evidence[] };
export type ScanResult = {
  status: "matched" | "no_match" | "needs_clarification"; scanId: string;
  persisted?: boolean; previewToken?: string;
  memory?: { ready: boolean; relationCount: number; promptVersion?: string };
  observedEntity?: string; entityKind?: "object" | "place"; specificity?: string; category?: string;
  person?: string; personName?: string; recipientId?: string | null; relation?: string; mention?: string;
  // "inspired": the ambition in the friend's own words. "prefers": what they said they like and avoid.
  activity?: string; preferences?: { likes: string[]; avoids: string[] }; preferenceMatch?: "observed" | "related";
  people?: { personId: string; personName: string; recipientId: string | null; relation: string; mention: string; sourceIds: string[]; evidence: Evidence[]; proximity?: import("./proximity").Proximity }[];
  location?: import("./location-proof").LocationVerification;
  proximity?: import("./proximity").Proximity;
  reason?: string; whyNow?: string; clarification?: string; sourceIds?: string[];
  evidence?: Evidence[]; caveats?: CaveatItem[]; advice?: AdviceItem[]; ruledOut?: RuledOutItem[];
  // Classifier view: the photo's AI-made topics and every plausible person's 0–1 confidence, highest first.
  topicMatches?: { topic: string; confidence: number }[];
  verification?: { checked: boolean; sensible?: boolean; why?: string; ms?: number; error?: string };
  ranking?: { personId: string; personName: string; relation: string; mention: string; topic?: string; score: number; eligible: boolean }[];
  timings?: { visionMs: number; relationsMs: number; sourcesMs?: number; memoryMs?: number; retrievalMs?: number;
    decisionMs?: number; contactsMs?: number; decidedMs?: number; assembledMs?: number; totalMs?: number; imagePreparationMs?: number };
  visionDiagnostics?: { provider: import("./model").ModelTimings; image?: { originalBytes: number; sentBytes: number; width: number; height: number; maxEdge: number; preparationMs: number } };
  model?: { provider: "meta" | "openai"; model: string; visionModel?: string };
  usage?: { vision?: { inputTokens: number; outputTokens: number; totalTokens?: number }; relations?: { inputTokens: number; outputTokens: number; totalTokens?: number } };
};
export type StageEvent = { type: string; message?: string; elapsedMs?: number; result?: ScanResult;
  code?: string; reason?: string; readiness?: string; sourcesMs?: number; memoryMs?: number;
  corpusRevision?: string; sourceCount?: number; relationCount?: number; promptVersion?: string };

export function formatDate(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return "date unknown";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
