import { notFound } from "next/navigation";
import webcamFixture from "../../../../fixtures/imaging-edge-webcam-local.json";
import { adviceMessage, decide, displayName, type ExtractedRelation, type Identification, type Source } from "@/lib/decision";
import { Bundle, stableSourceId } from "@/lib/demo-data";
import { shoppingSearchLinks } from "@/lib/commerce/live-search";
import type { Evidence, ScanResult } from "@/lib/scan-types";
import { WebcamPreview } from "./preview";

export default function LocalWebcamPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  const bundle = Bundle.parse(webcamFixture);
  const sources: Source[] = bundle.sources.map((source) => ({ ...source, id: stableSourceId("owner", source) }));
  const maya = sources.find((source) => source.speaker_id === "maya" && source.original_text.includes("Imaging Edge Webcam"));
  if (!maya || !sources.every((source) => source.is_synthetic)) throw new Error("The local webcam fixture is missing its labeled Maya message.");

  const identification: Identification = {
    item: "Imaging Edge Webcam", title: "Imaging Edge Webcam", category: "software", specificity: "exact_title",
    visibleText: ["Imaging Edge Webcam"], searchTerms: ["Imaging Edge Webcam"], ambiguity: "",
  };
  const relation: ExtractedRelation = {
    personId: "maya", subject: "person", relation: "owns", evidenceLevel: "exact_title",
    itemMention: identification.item, sentiment: "positive", sourceIds: [maya.id],
  };
  const decision = decide({ identification, relations: [relation], sources, ownerIds: ["owner"] });
  const connection = decision.connection;
  if (!connection || decision.status !== "matched") throw new Error("The local webcam fixture no longer produces a Maya connection.");

  const byId = new Map(sources.map((source) => [source.id, source]));
  const evidence = (ids: string[], role: Evidence["role"]): Evidence[] => ids.map((id) => {
    const source = byId.get(id)!;
    return { id, speakerId: source.speaker_id, role, text: source.original_text, date: source.source_at ?? "Date unknown", synthetic: source.is_synthetic, shareableQuote: source.speaker_id === "maya" };
  });
  const result: ScanResult = {
    scanId: "00000000-0000-4000-8000-000000000001", status: "matched", observedEntity: identification.item,
    entityKind: "object", specificity: identification.specificity, category: identification.category,
    person: connection.personId, personName: displayName(connection.personId), recipientId: null,
    relation: connection.relation, mention: connection.mention, reason: connection.reason, whyNow: connection.whyNow,
    sourceIds: connection.sourceIds, evidence: evidence(connection.sourceIds, "match"),
    advice: decision.advice.map((item) => ({
      personId: item.personId, personName: displayName(item.personId), recipientId: null,
      basis: item.basis, favorable: item.favorable, caution: item.caution, mention: item.mention,
      message: adviceMessage(item), sourceIds: item.sourceIds, evidence: evidence(item.sourceIds, "support"),
    })),
    ruledOut: [],
  };

  return <WebcamPreview
    result={result}
    search={shoppingSearchLinks(identification)}
    messages={sources.map((source) => ({ speaker: displayName(source.speaker_id), text: source.original_text, date: source.source_at }))}
    peopleCount={new Set(sources.map((source) => source.speaker_id)).size}
    mentionCount={decision.mentionCount}
  />;
}
