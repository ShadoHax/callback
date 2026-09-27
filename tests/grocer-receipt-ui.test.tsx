// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GrocerReceipt } from "../src/components/ar/grocer-receipt";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

it("does not claim success from a return URL without server verification", async () => {
  window.history.replaceState(null, "", "/ar?grocer_checkout=success&session_id=cs_test_example");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ paid: false, merchant: "Grocer", subtotalCents: 500 })));
  render(<GrocerReceipt />);
  expect(await screen.findByText("Test payment not confirmed")).toBeTruthy();
  expect(screen.queryByText("Test payment complete")).toBeNull();
});

it("shows a verified test subtotal and dismisses the return notice", async () => {
  window.history.replaceState(null, "", "/ar?grocer_checkout=success&session_id=cs_test_example");
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ paid: true, merchant: "Example Grocer", subtotalCents: 548 }));
  vi.stubGlobal("fetch", fetcher);
  render(<GrocerReceipt />);
  expect(await screen.findByText("Test payment complete")).toBeTruthy();
  expect(screen.getByText("Example Grocer · $5.48")).toBeTruthy();
  expect(screen.getByText("No groceries ordered or charged.")).toBeTruthy();
  expect(fetcher.mock.calls[0][0]).toBe("/api/ar/activity/checkout?sessionId=cs_test_example");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss checkout notice" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(window.location.search).toBe("");
});

it("shows cancelled checkout without requesting payment verification", async () => {
  window.history.replaceState(null, "", "/ar?grocer_checkout=cancelled");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<GrocerReceipt />);
  expect(await screen.findByText("Test checkout cancelled")).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
