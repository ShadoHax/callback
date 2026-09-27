// Model-free check of real sessions, row-level policies, messaging, and photo access:
//   npm run access:check [-- --app https://your-app] [--person maya]
// Runs after `npm run demo:setup`, before any model is available. The one scan it needs is a clearly labeled
// DEVELOPER FIXTURE inserted with the service role (never a model result); it and its messages/photos are deleted
// at the end. Without a reachable app, only the direct database/policy checks run.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { corpusRevision } from "../src/lib/corpus";
import { SOURCE_INDEX_LIMIT } from "../src/lib/source-selection";
import { flags, messagesOf, need, post, reachable, recorder, service, session, waitFor } from "./lib/live";

// A valid 1×1 JPEG so storage and signed URLs behave as with a real photo.
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

async function main() {
  const { read } = flags(process.argv.slice(2));
  const app = (read("app") ?? process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  const person = read("person") ?? process.env.DEMO_RECIPIENT_PERSON ?? "maya";
  const admin = service();
  const { checks, check } = recorder();
  const scanner = await session(app, need("DEMO_SCANNER_EMAIL"), need("DEMO_SCANNER_PASSWORD"));
  const recipient = await session(app, need("DEMO_RECIPIENT_EMAIL"), need("DEMO_RECIPIENT_PASSWORD"));
  console.log(`Signed in: scanner ${scanner.email}, recipient ${recipient.email}`);

  console.log("Row-level policies (direct, as each user)");
  const own = await scanner.direct.from("sources").select("id", { count: "exact", head: true }).eq("owner_id", scanner.id);
  check("scanner reads own sources", !own.error && (own.count ?? 0) > 0, `${own.count ?? 0} rows${own.error ? ` (${own.error.message})` : ""}`);
  for (const table of ["sources", "scans", "contacts", "orders"]) {
    const leak = await recipient.direct.from(table).select("*").eq("owner_id", scanner.id).limit(1);
    check(`recipient cannot read scanner's ${table}`, !leak.error && (leak.data ?? []).length === 0, leak.error?.message ?? "");
  }
  check("clients cannot insert sources", Boolean((await recipient.direct.from("sources").insert({ owner_id: recipient.id, speaker_id: "x", thread_id: "x", original_text: "x" })).error));
  check("clients cannot insert messages directly", Boolean((await scanner.direct.from("messages").insert({ sender_id: scanner.id, recipient_id: recipient.id, body: "x", client_request_id: crypto.randomUUID() })).error));

  // Developer fixture: a labeled scan row so sharing can be tested without inference.
  const { data: sources } = await admin.from("sources").select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic").eq("owner_id", scanner.id).limit(SOURCE_INDEX_LIMIT + 1);
  const cited = (sources ?? []).find((source) => source.speaker_id === person);
  const { data: contact } = await admin.from("contacts").select("recipient_id").eq("owner_id", scanner.id).eq("person_id", person).maybeSingle();
  check(`contact "${person}" maps to the recipient account`, contact?.recipient_id === recipient.id);
  const scanId = crypto.randomUUID(), sharedPath = `${scanner.id}/${scanId}.jpeg`, unsharedPath = `${scanner.id}/${crypto.randomUUID()}.jpeg`;
  const cleanup: (() => PromiseLike<{ error: unknown }>)[] = [];
  const realtimeMessages = new Set<string>();
  const channel = recipient.direct.channel(`access-check-${scanId}`, { config: { postgres_changes_options: { wait: true, timeout: 15000 } } })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${recipient.id}` }, (event) => { realtimeMessages.add(String(event.new.id)); });
  try {
    const subscribed = await new Promise<boolean>((done) => {
      const timer = setTimeout(() => done(false), 20000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer); done(status === "SUBSCRIBED");
        }
      });
    });
    check("recipient subscribes to authenticated Realtime", subscribed);
    cleanup.push(() => admin.storage.from("scan-images").remove([sharedPath, unsharedPath]));
    for (const path of [sharedPath, unsharedPath]) { const { error } = await admin.storage.from("scan-images").upload(path, JPEG, { contentType: "image/jpeg" }); if (error) throw new Error(`upload: ${error.message}`); }
    const result = { status: "matched", devFixture: "access-check fixture: NOT a model result", person, personName: person, recipientId: recipient.id, relation: "planned_together", sourceIds: cited ? [cited.id] : [], evidence: [], scanId };
    const { error: scanError } = await admin.from("scans").insert({ id: scanId, owner_id: scanner.id, image_path: sharedPath, result, trace: [], corpus_revision: corpusRevision(sources ?? []), capture_source: "phone_upload" });
    if (scanError) throw new Error(`fixture scan: ${scanError.message}`);
    cleanup.unshift(() => admin.from("scans").delete().eq("id", scanId));

    const other = await recipient.direct.storage.from("scan-images").createSignedUrl(unsharedPath, 60);
    check("recipient cannot open an unshared scan photo", Boolean(other.error) || !other.data?.signedUrl);
    const ownPhoto = await scanner.direct.storage.from("scan-images").createSignedUrl(unsharedPath, 60);
    check("scanner can open their own scan photo", !ownPhoto.error && Boolean(ownPhoto.data?.signedUrl), ownPhoto.error?.message ?? "");

    if (!(await reachable(app))) { check(`app reachable at ${app}`, false, "start the app (npm run dev) or pass --app for the messaging checks"); }
    else {
      console.log(`Messaging through ${app}`);
      const key = crypto.randomUUID();
      const payload = { kind: "scan", scanId, recipientId: recipient.id, body: "Access check: saw this and thought of you (developer fixture)", clientRequestId: key, ...(cited ? { quotedSourceId: cited.id } : {}) };
      const sent = await post(scanner, payload);
      check("scanner sends through the app", sent.status === 201, `status ${sent.status} ${sent.body.error ?? ""}`);
      if (sent.status === 201) {
        cleanup.unshift(() => admin.from("messages").delete().eq("reply_to", sent.body.id), () => admin.from("messages").delete().eq("scan_id", scanId));
        const realtime = subscribed ? await waitFor("Realtime message", async () => realtimeMessages.has(sent.body.id) || null, 10000).catch(() => null) : null;
        check("message arrives through Realtime without polling", Boolean(realtime));
        const seen = await waitFor("message at recipient", async () => (await messagesOf(recipient)).find((message) => message.id === sent.body.id)).catch(() => null);
        check("recipient receives it", Boolean(seen), seen ? `${seen.ms} ms (API polling, not browser Realtime)` : "not received");
        check("recipient sees the authorized quote", !cited || Boolean(seen?.value.quoted_text));
        const image = seen?.value.imageUrl ? await fetch(seen.value.imageUrl) : null;
        check("recipient can open the shared photo", image?.ok === true);
        const leak = await recipient.direct.from("messages").select("id").eq("scan_id", scanId);
        check("recipient reads the message through policy", !leak.error && (leak.data ?? []).length === 1);
        check("identical retry returns the same message", (await post(scanner, payload)).body.id === sent.body.id);
        check("same key with edited text is refused", (await post(scanner, { ...payload, body: `${payload.body} (edited)` })).status === 409);
        check("recipient cannot share the scanner's scan", (await post(recipient, { ...payload, clientRequestId: crypto.randomUUID() })).status === 403);
        const replyPayload = { kind: "reply", replyTo: sent.body.id, body: "Access check reply (scripted)", clientRequestId: crypto.randomUUID() };
        const reply = await post(recipient, replyPayload);
        const back = reply.status === 201 ? await waitFor("reply at scanner", async () => (await messagesOf(scanner)).find((message) => message.id === reply.body.id)).catch(() => null) : null;
        check("scanner receives the reply", Boolean(back), back ? `${back.ms} ms` : `status ${reply.status}`);
        if (reply.status === 201) {
          const retry = await post(recipient, replyPayload);
          check("identical reply retry retains the same message with its scan association", retry.status === 200 && retry.body.id === reply.body.id && retry.body.duplicate === true);
          check("same reply key with edited text is refused", (await post(recipient, { ...replyPayload, body: `${replyPayload.body} (edited)` })).status === 409);
        }
        if (back) {
          const followup = await post(scanner, { kind: "reply", replyTo: reply.body.id, body: "Access check: let's make a plan (scripted)", clientRequestId: crypto.randomUUID() });
          if (followup.status === 201) cleanup.unshift(() => admin.from("messages").delete().eq("id", followup.body.id));
          const continued = followup.status === 201 ? await waitFor("follow-up at recipient", async () => (await messagesOf(recipient)).find((message) => message.id === followup.body.id)).catch(() => null) : null;
          check("recipient receives a follow-up to their reply", continued?.value.reply_to === reply.body.id, `status ${followup.status}`);
          const restored = await messagesOf(scanner);
          check("reloading messages retains the scan's original conversation", restored.some((message) => message.id === sent.body.id && message.scan_id === scanId && message.purpose === "connection"));
        }
        check("scanner cannot reply to their own sent message", (await post(scanner, { kind: "reply", replyTo: sent.body.id, body: "x", clientRequestId: crypto.randomUUID() })).status === 403);
      }
    }
  } catch (error) { check("fixture setup", false, error instanceof Error ? error.message : String(error)); }
  finally {
    try { await recipient.direct.removeChannel(channel); } catch { /* fixture cleanup must still run */ }
    // Close Realtime heartbeat/reconnect timers so this CLI process can finish.
    recipient.direct.realtime.disconnect();
    let clean = true;
    for (const step of cleanup) { try { if ((await step()).error) clean = false; } catch { clean = false; } }
    if (clean) console.log("  · developer fixture scan, messages, and photos removed");
    else check("developer fixture cleanup", false, `Inspect fixture ${scanId}; one or more cleanup operations failed.`);
  }

  const passed = checks.filter((item) => item.ok).length;
  console.log(`\n${passed}/${checks.length} access checks passed. No model was called.`);
  await mkdir(resolve("data/private/live"), { recursive: true });
  await writeFile(resolve("data/private/live", `access-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ app, checks }, null, 2));
  process.exitCode = passed === checks.length ? 0 : 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
