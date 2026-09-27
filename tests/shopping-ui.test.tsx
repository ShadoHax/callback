// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectionCard } from "../src/components/connection";
import { Shopping } from "../src/components/shopping";
import { adviceMessage, decide, type Source } from "../src/lib/decision";
import { Bundle, stableSourceId } from "../src/lib/demo-data";
import { shoppingSearchLinks } from "../src/lib/commerce/live-search";
import type { ScanResult } from "../src/lib/scan-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const result: ScanResult = { scanId: "scan", status: "matched", person: "maya", personName: "Maya", relation: "planned_together" };
const config = { enabled: true, checkout: "stripe_test", merchant: { name: "Demo", label: "TEST" } };
const option = { productId: "box", title: "Nesting box", variant: "Storage", merchant: "Demo", match: "family", totals: { subtotalCents: 4000, shippingCents: 599, taxCents: 280, totalCents: 4879 }, stock: 3, reasons: [], tradeoffs: [] };
const options = { options: [option], excluded: [], personalization: [] };
const order = { id: "order", status: "quoted", title: "Nesting box", variant: "Storage", merchant: "Demo", ...option.totals, quoteExpiresAt: "2026-09-26T12:15:00Z", purpose: { kind: "together", personId: "maya" } };
const deferred = () => { let resolve!: (value: Response) => void; const promise = new Promise<Response>((done) => { resolve = done; }); return { promise, resolve }; };
async function mount(fetcher: typeof fetch) {
  vi.stubGlobal("fetch", fetcher);
  render(<Shopping result={result} userId="alex" messages={[]} messagesReady refresh={async () => {}} />);
  fireEvent.click(await screen.findByText("Shopping for this?"));
  await screen.findByLabelText("Must be");
}

it("sends the exact filter selection with the quote and clears it when the budget changes", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) => Response.json(url === "/api/shop/config" ? config : url === "/api/shop/options" ? options : { order }));
  await mount(fetcher);
  fireEvent.change(screen.getByLabelText("Must be"), { target: { value: "accessory" } });
  fireEvent.click(screen.getByRole("button", { name: /Show options/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Review test total" }));
  await screen.findByText("Review your test order");
  const request = fetcher.mock.calls.find(([url]) => url === "/api/shop/quote")!;
  expect(JSON.parse(request[1]?.body as string)).toMatchObject({ preference: "accessory", budgetCents: 8000, purpose: { kind: "together", personId: "maya" } });
  fireEvent.change(screen.getByLabelText(/Budget/), { target: { value: "20" } });
  expect(screen.queryByText("Review your test order")).toBeNull();
  expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
});

it("discards options that arrive after the user changed filters", async () => {
  const pending = deferred();
  await mount(vi.fn(async (url) => url === "/api/shop/config" ? Response.json(config) : pending.promise));
  fireEvent.change(screen.getByLabelText("Must be"), { target: { value: "base" } });
  await act(async () => { pending.resolve(Response.json(options)); });
  expect(screen.queryByText("Nesting box")).toBeNull();
});

it("discards a quote that arrives after the user changed the intended recipient", async () => {
  const pending = deferred();
  const fetcher = vi.fn<typeof fetch>(async (url) => url === "/api/shop/quote" ? pending.promise : Response.json(url === "/api/shop/config" ? config : options));
  await mount(fetcher);
  fireEvent.click(await screen.findByRole("button", { name: "Review test total" }));
  fireEvent.change(screen.getByLabelText("For", { exact: true }), { target: { value: "0" } });
  await act(async () => { pending.resolve(Response.json({ order })); });
  expect(screen.queryByText("Review your test order")).toBeNull();
});

it("locks the reviewed selection while approval is in flight", async () => {
  const pending = deferred();
  const fetcher = vi.fn<typeof fetch>(async (url) => String(url).endsWith("/approve") ? pending.promise : Response.json(url === "/api/shop/config" ? config : url === "/api/shop/options" ? options : { order }));
  await mount(fetcher);
  fireEvent.click(await screen.findByRole("button", { name: "Review test total" }));
  fireEvent.click(await screen.findByRole("button", { name: /Approve/ }));
  expect((screen.getByLabelText(/Budget/) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Back to options" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { pending.resolve(Response.json({ kind: "changed", order: { ...order, variant: "Revised storage" } }, { status: 409 })); });
  await waitFor(() => expect(screen.getByText(/Your quote changed/)).toBeTruthy());
  expect(screen.getByText(/Revised storage/)).toBeTruthy();
});

it("shows the local Maya connection, cited feedback, Sony information, and live search links", async () => {
  const bundle = Bundle.parse(JSON.parse(readFileSync("fixtures/imaging-edge-webcam-local.json", "utf8")));
  const sources: Source[] = bundle.sources.map((source) => ({ ...source, id: stableSourceId("owner", source) }));
  const maya = sources.find((source) => source.original_text.includes("Imaging Edge Webcam"))!;
  const identified = { item: "Imaging Edge Webcam", title: "Imaging Edge Webcam", category: "software", specificity: "exact_title" as const, visibleText: ["Imaging Edge Webcam"], searchTerms: ["Imaging Edge Webcam"], ambiguity: "" };
  const decision = decide({ identification: identified, sources, ownerIds: ["owner"], relations: [{ personId: "maya", subject: "person", relation: "owns", evidenceLevel: "exact_title", itemMention: identified.item, sentiment: "positive", sourceIds: [maya.id], reason: "" }] });
  expect(decision.status).toBe("matched");
  const connection = decision.connection!;
  const advice = decision.advice[0];
  const evidence = { id: maya.id, speakerId: "maya", text: maya.original_text, date: maya.source_at!, synthetic: true };
  const scan: ScanResult = {
    scanId: "scan", status: decision.status, observedEntity: identified.item, person: "maya", personName: "Maya", relation: connection.relation, reason: connection.reason,
    evidence: [evidence], advice: [{ personId: "maya", personName: "Maya", basis: "owns", favorable: advice.favorable, caution: false, mention: identified.item, message: adviceMessage(advice), sourceIds: [maya.id], recipientId: null, evidence: [evidence] }],
  };
  const live = shoppingSearchLinks(identified);
  vi.stubGlobal("fetch", vi.fn(async (url) => url === "/api/shop/config" ? Response.json({ enabled: false, checkout: null, merchant: { name: "Demo", label: "TEST" } }) : Response.json(live)));
  const oldScrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  try {
    render(<><ConnectionCard result={scan} /><Shopping result={scan} userId="alex" messages={[]} messagesReady refresh={async () => {}} /></>);
    expect(screen.getByRole("heading", { name: "Maya" })).toBeTruthy();
    expect(screen.getByText("Maya said they own one and like it.")).toBeTruthy();
    expect(screen.getByText("synthetic demo context")).toBeTruthy();
    fireEvent.click(screen.getByText("Shopping for this?"));
    expect(await screen.findByText(/Maya has one and spoke well of it/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read their words" }));
    expect(await screen.findByText(maya.original_text)).toBeTruthy();
    expect(await screen.findByText("Free from Sony")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Download from Sony/ }).getAttribute("href")).toBe(live.software!.downloadUrl);
    expect(screen.getByRole("link", { name: /Google Shopping/ }).getAttribute("href")).toBe(live.shoppingUrl);
    expect(screen.getByRole("link", { name: /Search eBay for Sony cameras/ }).getAttribute("href")).toBe(live.searchUrl);
    expect(screen.queryByText(/Demo catalog/)).toBeNull();
  } finally {
    HTMLElement.prototype.scrollIntoView = oldScrollIntoView;
  }
});

it("opens the local preview's shopping information without requesting a configured account", async () => {
  const search = shoppingSearchLinks({ item: "Imaging Edge Webcam", title: "Imaging Edge Webcam", specificity: "exact_title" });
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  const scan: ScanResult = {
    scanId: "local", status: "matched", person: "maya", personName: "Maya", relation: "owns",
    advice: [{ personId: "maya", personName: "Maya", basis: "owns", favorable: true, caution: false, mention: "Imaging Edge Webcam", message: "Maya has one and spoke well of it.", sourceIds: ["source"], recipientId: null, evidence: [] }],
  };
  render(<Shopping result={scan} previewSearch={search} userId="local-preview" messages={[]} messagesReady refresh={async () => {}} />);
  fireEvent.click(screen.getByText("Shopping for this?"));
  expect(await screen.findByText("Free from Sony")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Google Shopping/ }).getAttribute("href")).toBe(search.shoppingUrl);
  fireEvent.click(screen.getByRole("button", { name: "Draft a question for Maya" }));
  expect((screen.getByLabelText("Your question to Maya") as HTMLTextAreaElement).value).toContain("Imaging Edge Webcam");
  expect(screen.getByText("Local draft only. Nothing is sent.")).toBeTruthy();
  expect(screen.queryByText(/isn't linked to a demo account/)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
