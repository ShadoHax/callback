import { adminSupabase } from "./admin-supabase";
import { OWNER_SPEAKER, Source, adviceMessage, caveatMessage, decide, displayName, relationLabel, ruledOutMessage, type RuledOut } from "./decision";
import { identifyItem } from "./meta";
import { ModelError, modelConfig } from "./model";
import { corpusRevision } from "./corpus";
import { SOURCE_INDEX_LIMIT } from "./source-selection";
import { loadCurrentIndex, memoryTopics, relationsForPhoto } from "./knowledge-index";
import { signPreview } from "./scan-preview";
import { VERIFY_BELOW_SCORE, verifyDecision, type Verification } from "./verify";
import { publicLocation, verifyLocation, type LocationProof } from "./location-proof";
import { proximity, type Presence, type Proximity } from "./proximity";

export type CaptureSource = "phone_upload" | "phone_camera" | "quest" | "glasses";
const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
const specificityLabel = { exact_title: "exact match", product_family: "product family only", category: "general category only" } as const;
type Role = "match" | "earlier" | "newer" | "caveat" | "support";

export function scanFailure(message: string, status: number) {
  return new Response(`${JSON.stringify({ type: "error", message })}\n`, { status, headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

export function validImage(image: FormDataEntryValue | null): image is File {
  return image instanceof File && acceptedTypes.includes(image.type) && image.size > 0 && image.size <= 8 * 1024 * 1024;
}

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "date unknown");

class Cancelled extends Error {}
class MemoryRequired extends Error {
  constructor(readonly reason: "missing_or_stale" | "read_failed" | "no_sources") {
    super(reason === "no_sources" ? "No sources are available. Import approved context before scanning." : reason === "read_failed"
      ? "Could not check prepared memory. Refresh memory, then scan again."
      : "Your prepared memory is missing or out of date. Refresh memory, then scan again.");
  }
}

export function scanResponse(input: { ownerId: string; image: File; captureSource: CaptureSource; deviceId?: string; preview?: boolean; location?: LocationProof; signal?: AbortSignal }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return scanFailure("Live scanning is not fully configured.", 503);
  let model: { provider: "meta" | "openai"; model: string; visionModel: string };
  try { const config = modelConfig(); model = { provider: config.provider, model: config.model, visionModel: config.visionModel }; }
  catch (error) { return scanFailure(error instanceof ModelError ? error.message : "Model settings are invalid.", 503); }
  const { ownerId, image, captureSource, deviceId } = input;
  const scanId = crypto.randomUUID();
  const encoder = new TextEncoder();
  const started = Date.now();
  // Aborts paid model calls if the phone disconnects; nothing is retried automatically.
  const abort = new AbortController();
  input.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  let closed = false;
  const body = new ReadableStream({
    async start(controller) {
      let sequence = 0;
      const trace: object[] = [];
      const path = `${ownerId}/${scanId}.${image.type.split("/")[1]}`;
      let upload: Promise<{ error: unknown }> | null = null;
      let memoryCheck: { sourcesMs: number; memoryMs: number; corpusRevision: string; sourceCount: number } | undefined;
      const write = (event: object) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { closed = true; }
      };
      const emit = (type: string, message: string, extra: object = {}) => {
        if (abort.signal.aborted) throw new Cancelled();
        const event = { type, scanId, sequence: ++sequence, at: new Date().toISOString(), elapsedMs: Date.now() - started, message, captureSource, ...extra };
        trace.push(event); write(event);
      };
      try {
        const admin = adminSupabase();
        emit("frame_received", "Photo received.");
        const sourcesStarted = Date.now();
        const { data, error } = await admin.from("sources").select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic").eq("owner_id", ownerId).order("created_at", { ascending: true }).limit(SOURCE_INDEX_LIMIT + 1);
        if (error) throw new Error("Could not load private sources.");
        if ((data?.length ?? 0) > SOURCE_INDEX_LIMIT) throw new Error(`Source corpus exceeds the current ${SOURCE_INDEX_LIMIT.toLocaleString()}-record index limit.`);
        const corpus = Source.array().parse(data ?? []);
        const revision = corpusRevision(corpus);
        const sourcesMs = Date.now() - sourcesStarted;
        if (corpus.length === 0) {
          memoryCheck = { sourcesMs, memoryMs: 0, corpusRevision: revision, sourceCount: 0 };
          throw new MemoryRequired("no_sources");
        }

        const memoryStarted = Date.now();
        const memory = await loadCurrentIndex({ ownerId, sources: corpus, admin }).catch(() => {
          memoryCheck = { sourcesMs, memoryMs: Date.now() - memoryStarted, corpusRevision: revision, sourceCount: corpus.length };
          throw new MemoryRequired("read_failed");
        });
        const memoryMs = Date.now() - memoryStarted;
        memoryCheck = { sourcesMs, memoryMs, corpusRevision: revision, sourceCount: corpus.length };
        if (!memory) throw new MemoryRequired("missing_or_stale");
        emit("memory_checked", "Prepared memory is current.", { readiness: "ready", ...memoryCheck, relationCount: memory.relations.length, promptVersion: memory.promptVersion });
        // Upload in parallel with vision only after memory has passed its freshness check.
        if (!input.preview) upload = admin.storage.from("scan-images").upload(path, image, { contentType: image.type, upsert: false }).then(({ error }) => ({ error }), (error) => ({ error }));
        // The memory's AI-made topics (e.g. "pottery", "camping") become the classifier's label set for this photo.
        const topics = memoryTopics(memory);
        const vision = await identifyItem(image, abort.signal, topics);
        const identification = vision.value;
        const location = verifyLocation(input.location);
        emit("entity_identified", `Identified: ${identification.item} · ${specificityLabel[identification.specificity]}`, { identification, ms: vision.ms, attempts: vision.attempts, image: vision.imageMetrics, providerTimings: vision.timings });
        if (identification.entityKind === "place") emit(location?.verified ? "location_verified" : "location_needed", location?.verified ? `Recent device location supplied with ${Math.round(location.accuracy)} m reported accuracy.` : "This looks like a place, but a fresh device location is required before making a callback.");
        const sources = corpus;
        const people = new Set(sources.map((source) => source.speaker_id).filter((id) => id !== OWNER_SPEAKER && id !== ownerId));
        emit("context_loaded", `Prepared memory covers ${sources.length} approved messages from ${people.size} ${people.size === 1 ? "person" : "people"}.`, { sourceCount: sources.length, corpusCount: corpus.length });
        emit("searching", "Looking up prepared relationship memory…");

        const retrievalStarted = Date.now();
        if (identification.topicMatches?.length) emit("topics_classified", `Looks like: ${identification.topicMatches.map((match) => `${match.topic} (${Math.round(match.confidence * 100)}%)`).join(", ")}.`, { topicMatches: identification.topicMatches, topicCount: topics.length });
        const extraction = { value: { relations: relationsForPhoto(identification, memory) }, ms: 0 };
        const retrievalMs = Date.now() - retrievalStarted;
        const decisionStarted = Date.now();
        const proposed = decide({ identification, relations: extraction.value.relations, sources, ownerIds: [ownerId] });
        const decisionMs = Date.now() - decisionStarted;
        // Propose → verify: a match reached through topics/kind (not an exact title) gets a fast second check first.
        const winnerRelation = proposed.connection && extraction.value.relations.find((relation) => relation.personId === proposed.connection!.personId && relation.itemMention === proposed.connection!.mention && relation.relation === proposed.connection!.relation);
        let verification: Verification = { checked: false };
        let decision = proposed;
        const topScore = proposed.ranking.find((item) => item.personId === proposed.connection?.personId)?.score ?? 0;
        if (winnerRelation?.matchConfidence !== undefined && topScore < VERIFY_BELOW_SCORE) {
          emit("verifying", `Double-checking the link to ${displayName(proposed.connection!.personId)}…`);
          ({ decision, verification } = await verifyDecision(proposed, identification, sources, abort.signal));
          emit("verified", verification.checked ? (verification.sensible ? `Confirmed: ${verification.why}` : `Held back: ${verification.why}`) : "Second check unavailable; showing the scored match.", { verification });
        }
        emit("mentions_found", decision.mentionCount ? `Found ${decision.mentionCount} mention${decision.mentionCount === 1 ? "" : "s"} across ${decision.peopleCount} ${decision.peopleCount === 1 ? "person" : "people"}.` : "No messages refer to it.", { mentionCount: decision.mentionCount, peopleCount: decision.peopleCount, droppedCount: decision.droppedCount, ms: extraction.ms });
        for (const item of decision.ruledOut) emit("ruled_out", ruledOutMessage(item), { personId: item.personId, code: item.code, sourceIds: item.sourceIds });

        const placeNeedsLocation = identification.entityKind === "place" && !location?.verified;
        const connection = placeNeedsLocation ? null : decision.connection;
        const connections = placeNeedsLocation ? [] : decision.connections;
        let recipientId: string | null = null;
        const contactByPerson = new Map<string, string | null>();
        if (connection) {
          const favorableOwner = connection.relation === "owns" && decision.advice.some((item) => item.personId === connection.personId && item.favorable);
          const relation = favorableOwner ? "has one and likes it" : relationLabel(connection.relation);
          emit("matched", connections.length > 1 ? `Group match: ${connections.map((item) => displayName(item.personId)).join(", ")}.` : `Match: ${displayName(connection.personId)} ${relation} (${shortDate(connection.observedAt)}).`);
        } else if (placeNeedsLocation) emit("needs_clarification", "Allow location and keep this place in view to verify that you're there.");
        else if (decision.status === "needs_clarification") emit("needs_clarification", "Can't confirm the exact version from this photo.");
        else emit("no_match", "No supported connection found in your shared context.");

        // A group and its supporting advice can share contacts. Fetch only those person IDs for this owner.
        const contactsStarted = Date.now();
        const contactIds = [...new Set([...connections.map((item) => item.personId), ...decision.advice.map((item) => item.personId)])];
        if (contactIds.length) {
          const { data: contacts, error: contactError } = await admin.from("contacts")
            .select("person_id,recipient_id").eq("owner_id", ownerId).in("person_id", contactIds);
          if (contactError && connections.length) throw new Error("Could not verify the demo contact.");
          const recipients = new Map((contacts ?? []).map((contact) => [contact.person_id, contact.recipient_id]));
          for (const personId of contactIds) contactByPerson.set(personId, recipients.get(personId) ?? null);
        }
        const contactsMs = Date.now() - contactsStarted;
        recipientId = connection ? contactByPerson.get(connection.personId) ?? null : null;

        const proximityByPerson = new Map<string, Proximity>();
        const recipientIds = [...new Set(connections.map((item) => contactByPerson.get(item.personId)).filter((id): id is string => Boolean(id)))];
        if (process.env.NEXT_PUBLIC_ENABLE_PROXIMITY === "true" && location?.verified && recipientIds.length) {
          // Presence is optional. A missing table or transient lookup error must not block the callback.
          try {
            const { data: rows, error: presenceError } = await admin.from("location_presence").select("user_id,latitude,longitude,accuracy,captured_at,expires_at").in("user_id", [ownerId, ...recipientIds]).gt("expires_at", new Date().toISOString());
            if (!presenceError) {
              const scannerRow = rows?.find((row) => row.user_id === ownerId);
              const scannerPresence = scannerRow && { latitude: scannerRow.latitude, longitude: scannerRow.longitude, accuracy: scannerRow.accuracy, capturedAt: scannerRow.captured_at };
              if (scannerPresence) {
                const personByRecipient = new Map(connections.map((item) => [contactByPerson.get(item.personId), item.personId]));
                for (const row of rows ?? []) {
                  const personId = personByRecipient.get(row.user_id);
                  const nearby = personId ? proximity(scannerPresence, { userId: row.user_id, latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy, capturedAt: row.captured_at, expiresAt: row.expires_at } satisfies Presence) : undefined;
                  if (personId && nearby) proximityByPerson.set(personId, nearby);
                }
                const samePlace = connections.filter((item) => proximityByPerson.get(item.personId)?.status === "same_place");
                if (samePlace.length) emit("contact_nearby", samePlace.length === 1 ? `${displayName(samePlace[0].personId)} may be in the same place.` : `${samePlace.length} people from this callback may be in the same place.`);
              }
            }
          } catch {
            // Nearby discovery is optional; the photo callback can still complete.
          }
        }

        const uploaded = upload ? await upload : null;
        if (uploaded?.error) throw new Error("Could not save the scan image.");
        const byId = new Map(sources.map((source) => [source.id, source]));
        const evidenceFor = (ids: string[], role: Role, personId?: string) => ids.map((id) => byId.get(id)!).map((source) => ({
          id: source.id, speakerId: source.speaker_id, role, text: source.original_text, date: source.source_at ?? "Date unknown", synthetic: source.is_synthetic,
          ...(personId ? { shareableQuote: source.speaker_id === personId && source.participant_ids.includes(personId) } : {}),
        }));
        // Every explanation carries the messages it rests on, including the newer message behind an update.
        const ruledOutEvidence = (item: RuledOut) => item.contradiction ? [...evidenceFor(item.contradiction.sourceIds, "newer"), ...evidenceFor(item.sourceIds, "earlier")] : evidenceFor(item.sourceIds, "support");
        const assembledMs = Date.now() - started;
        const result = {
          status: placeNeedsLocation ? "needs_clarification" : decision.status, observedEntity: identification.item, entityKind: identification.entityKind ?? "object", specificity: identification.specificity, category: identification.category, location: publicLocation(location), proximity: connection ? proximityByPerson.get(connection.personId) : undefined,
          identification: { item: identification.item, title: identification.title ?? "", edition: identification.edition ?? "", category: identification.category, specificity: identification.specificity, searchTerms: identification.searchTerms, visibleText: identification.visibleText, visibleItems: identification.visibleItems ?? [] },
          person: connection?.personId ?? "", personName: connection ? displayName(connection.personId) : "", recipientId,
          relation: connection?.relation ?? "", mention: connection?.mention ?? "", reason: connection?.reason ?? "", whyNow: connection?.whyNow ?? "", clarification: decision.clarification,
          ...(connection?.activity ? { activity: connection.activity } : {}), ...(connection?.preferences ? { preferences: connection.preferences } : {}),
          ...(connection?.preferenceMatch ? { preferenceMatch: connection.preferenceMatch } : {}),
          sourceIds: connection?.sourceIds ?? [],
          evidence: connection ? evidenceFor(connection.sourceIds, "match", connection.personId) : [],
          people: connections.map((item) => ({ personId: item.personId, personName: displayName(item.personId), recipientId: contactByPerson.get(item.personId) ?? null, relation: item.relation, mention: item.mention, sourceIds: item.sourceIds, evidence: evidenceFor(item.sourceIds, "match", item.personId), proximity: proximityByPerson.get(item.personId) })),
          caveats: connection ? connection.caveats.map((caveat) => ({ reason: caveat.reason, message: caveatMessage(connection.personId, caveat), evidence: evidenceFor(caveat.sourceIds, "caveat") })) : [],
          advice: decision.advice.map((item) => ({ personId: item.personId, personName: displayName(item.personId), basis: item.basis, favorable: item.favorable, caution: item.caution, mention: item.mention, message: adviceMessage(item), sourceIds: item.sourceIds, recipientId: contactByPerson.get(item.personId) ?? null, evidence: evidenceFor(item.sourceIds, "support", item.personId) })),
          ruledOut: decision.ruledOut.map((item) => ({ personId: item.personId, personName: displayName(item.personId), code: item.code, message: ruledOutMessage(item), evidence: ruledOutEvidence(item) })),
          ranking: decision.ranking.map((item) => ({ ...item, personName: displayName(item.personId) })), topicMatches: identification.topicMatches ?? [],
          verification,
          timings: { sourcesMs, memoryMs, visionMs: vision.ms, imagePreparationMs: vision.imageMetrics?.preparationMs ?? 0, retrievalMs, relationsMs: extraction.ms, decisionMs, contactsMs,
            decidedMs: assembledMs, assembledMs },
          ...(vision.timings ? { visionDiagnostics: { provider: vision.timings, image: vision.imageMetrics } } : {}),
          model, usage: { ...(vision.usage ? { vision: vision.usage } : {}) },
          scanId, corpusRevision: revision, captureSource, persisted: !input.preview, memory: { ready: true, relationCount: extraction.value.relations.length, promptVersion: memory.promptVersion },
        };
        if (abort.signal.aborted) throw new Cancelled();
        if (input.preview) {
          const previewToken = await signPreview({ ownerId, image, result, trace });
          write({ type: "result", scanId, sequence: sequence + 1, at: new Date().toISOString(), elapsedMs: Date.now() - started, message: "Preview ready. Tap to save and open.", captureSource, result: { ...result, previewToken } });
          return;
        }
        const { error: saveError } = await admin.from("scans").insert({ id: scanId, owner_id: ownerId, image_path: path, result, trace, corpus_revision: revision, capture_source: captureSource, device_id: deviceId ?? null });
        if (saveError) throw new Error("Could not save the scan result.");
        upload = null;
        // The terminal event is sent only after the scan is persisted, so its time is the real completion time.
        write({ type: "result", scanId, sequence: sequence + 1, at: new Date().toISOString(), elapsedMs: Date.now() - started, message: "Scan complete.", captureSource, result });
      } catch (cause) {
        if (upload) void upload.then(({ error }) => { if (!error) return adminSupabase().storage.from("scan-images").remove([path]); }).catch(() => {});
        if (cause instanceof Cancelled || abort.signal.aborted) return;
        if (cause instanceof MemoryRequired) {
          emit("memory_checked", "Prepared memory needs attention.", { readiness: "required", reason: cause.reason, ...(memoryCheck ?? {}) });
          write({ type: "error", code: "memory_required", reason: cause.reason, scanId, sequence: ++sequence,
            at: new Date().toISOString(), elapsedMs: Date.now() - started, message: cause.message, captureSource,
            ...(memoryCheck ?? {}) });
          return;
        }
        const detail = cause instanceof Error ? cause.message : "";
        const safe = cause instanceof ModelError || /^(Could not load private sources|Source corpus exceeds|No sources are available|Could not save the scan image|Could not save the scan result|Could not verify the demo contact|Prepare memory before)/.test(detail);
        // A failed inference is reported as a failure, never replaced with a precomputed answer.
        write({ type: "error", scanId, sequence: ++sequence, at: new Date().toISOString(), elapsedMs: Date.now() - started, message: safe ? detail : "The scan could not be completed or verified. Please retry.", captureSource,
          ...(cause instanceof ModelError && cause.timings ? { providerTimings: cause.timings } : {}) });
      } finally {
        if (!closed) { closed = true; try { controller.close(); } catch { /* already closed */ } }
      }
    },
    cancel() { closed = true; abort.abort(); },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
