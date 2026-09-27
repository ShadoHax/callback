// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Composer, draftFor } from "../src/components/composer";
import { Shopping } from "../src/components/shopping";
import type { Message } from "../src/lib/use-inbox";
import type { ScanResult } from "../src/lib/scan-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const result: ScanResult = { scanId: "scan", status: "matched", person: "maya", personName: "Maya", recipientId: "maya-account", mention: "Wingspan", relation: "planned_together" };
const root: Message = { id: "root", sender_id: "alex", recipient_id: "maya-account", scan_id: "scan", purpose: "connection", body: "Still want to play?", created_at: "2026-09-26T12:00:00Z" };
const reply: Message = { id: "reply", sender_id: "maya-account", recipient_id: "alex", reply_to: "root", body: "Yes, Sunday works!", created_at: "2026-09-26T12:01:00Z" };
const props = { result, messages: [root, reply], userId: "alex", messagesReady: true, refresh: vi.fn(async () => {}) };

it("offers an immediate hello when the matched friend may be in the same place", () => {
  expect(draftFor({ relation: "experienced_together", mention: "Wingspan", proximity: { status: "same_place", distanceBand: "within_75m", checkedAt: "2026-09-26T12:00:00Z" } })).toMatch(/same place/i);
});

it("reopens a stored exchange and sends a follow-up to the friend's reply", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "follow-up" })); vi.stubGlobal("fetch", fetcher);
  render(<Composer {...props} />);
  expect(screen.queryByRole("button", { name: /Send to Maya/ })).toBeNull();
  expect(screen.getByText("Yes, Sunday works!")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Keep the conversation going"), { target: { value: "I'll bring it!" } });
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  await waitFor(() => expect(props.refresh).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({ kind: "reply", replyTo: "reply", body: "I'll bring it!" });
});

it("locks and retries the same follow-up after a lost response", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(Response.json({ id: "follow-up" })); vi.stubGlobal("fetch", fetcher);
  render(<Composer {...props} />);
  fireEvent.change(screen.getByLabelText("Keep the conversation going"), { target: { value: "Sunday at two?" } });
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry reply" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
});

it("does not offer another initial send before persisted messages have loaded", () => {
  render(<Composer {...props} messages={[]} messagesReady={false} />);
  expect(screen.queryByRole("button", { name: /Send to Maya/ })).toBeNull();
  expect(screen.getByText(/Checking your conversation/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /personal app/ })).toBeTruthy();
});

it("can hand the edited draft to a personal app without a linked Callback account", async () => {
  const share = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  render(<Composer {...props} messages={[]} result={{ ...result, recipientId: undefined }} />);
  const draft = screen.getByLabelText("Your message to Maya");
  fireEvent.change(draft, { target: { value: "This made me think of you—coffee next week?" } });
  fireEvent.click(screen.getByRole("button", { name: /personal app/ }));
  await waitFor(() => expect(share).toHaveBeenCalledWith({ text: "This made me think of you—coffee next week?" }));
  expect(screen.queryByRole("button", { name: /Send to Maya/ })).toBeNull();
});

it("keeps a shared-plan invitation editable and only shares quoted evidence after explicit send", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "new-message" }));
  vi.stubGlobal("fetch", fetcher);
  render(<Composer {...props} messages={[]} result={{ ...result, evidence: [{ id: "maya-source", speakerId: "maya", text: "We should play Wingspan together", date: "2026-09-20T12:00:00Z", synthetic: false, shareableQuote: true }] }} />);
  const draft = screen.getByLabelText("Your message to Maya") as HTMLTextAreaElement;
  expect(draft.value).toContain("Still want to do it together?");
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(draft, { target: { value: "Want to play Wingspan on Sunday?" } });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText("We should play Wingspan together")).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Send to Maya/ }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({ kind: "scan", body: "Want to play Wingspan on Sunday?", quotedSourceId: "maya-source" });
});

it("restores advice independently when Maya and Noah share a demo phone", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: true, merchant: { name: "Demo", label: "TEST" } })));
  const advice = { ...root, id: "advice", purpose: "advice", about_person_id: "noah", body: "How has yours held up?" };
  render(<Shopping {...props} messages={[root, advice]} result={{ ...result, advice: [{ personId: "noah", personName: "Noah", basis: "owns", favorable: false, caution: false, mention: "Wingspan", message: "Noah owns it.", sourceIds: [], recipientId: "maya-account", evidence: [] }] }} />);
  expect(await screen.findByText("How has yours held up?")).toBeTruthy();
  expect(screen.queryByText(root.body)).toBeNull();
  expect(screen.queryByRole("button", { name: "Ask Noah" })).toBeNull();
});
