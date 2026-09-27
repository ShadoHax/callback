// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Composer, draftFor } from "../src/components/composer";
import type { ScanResult } from "../src/lib/scan-types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const result: ScanResult = { scanId: "scan", status: "matched", person: "friend", personName: "Friend", recipientId: "recipient", relation: "recommended", mention: "War and Peace" };
const props = { result, messages: [], userId: "owner", messagesReady: true, refresh: vi.fn(async () => {}) };

it("starts a favorable owner conversation from their experience instead of implying they need another", () => {
  expect(draftFor({ relation: "owns", mention: "Imaging Edge Webcam" })).toBe("I came across Imaging Edge Webcam and remembered you have it and like it. What has your experience been?");
});

it("keeps iPhone texting available after clipboard denial and requires an explicit open link", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ phone: "+12175550123" }));
  vi.stubGlobal("fetch", fetcher);
  render(<Composer {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Text Friend from my number/ }));
  const link = await screen.findByRole("link", { name: /Open Messages for Friend/ });
  expect(link.getAttribute("href")).toBe("sms:+12175550123");
  expect(screen.getByText(/Copy the draft above manually/)).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("/api/messages/sms/compose");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Changed my message" } });
  expect(screen.queryByRole("link", { name: /Open Messages/ })).toBeNull();
});

it("does not expose an SMS link when the stored connection is stale", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Context changed. Scan again." }, { status: 409 })));
  render(<Composer {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Text Friend from my number/ }));
  expect(await screen.findByText("Context changed. Scan again.")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Open Messages/ })).toBeNull();
});
