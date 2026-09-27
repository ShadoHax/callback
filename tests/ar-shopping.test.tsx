// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useArShopping } from "../src/components/ar/ar-shopping";
import type { Purpose } from "../src/lib/commerce/options";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function offer(title: string, merchantUrl = "https://merchant.example/item", caveats: string[] = []) {
  return { id: title, title, merchant: "Merchant", merchantUrl, imageUrl: null,
    price: { amountCents: 1299, currency: "USD", observedAt: "2026-09-26T12:00:00.000Z" },
    availability: "unknown", match: "family", reasons: [], caveats, source: { provider: "test", position: 0 } };
}
function discovery(offers: ReturnType<typeof offer>[], fallbackSearchUrl = "https://www.google.com/search?tbm=shop&q=coffee") {
  return { query: "coffee", offers, fallbackSearchUrl, status: offers.length ? "ok" : "no_verified_offers", provider: "test" };
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

it("rejects an old scan response after switching scans, even if the server ignores abort", async () => {
  const first = deferred(), second = deferred();
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  vi.stubGlobal("fetch", fetcher);
  const { result, rerender } = renderHook(({ scanId }) => useArShopping(scanId), { initialProps: { scanId: "scan-a" } });
  expect(result.current.status).toBe("loading");
  rerender({ scanId: "scan-b" });
  expect(result.current.status).toBe("loading");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((fetcher.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  await act(async () => { second.resolve(Response.json(discovery([offer("Current coffee")]))) });
  await waitFor(() => expect(result.current.title).toBe("Current coffee"));
  await act(async () => { first.resolve(Response.json(discovery([offer("Old coffee")]))) });
  expect(result.current.title).toBe("Current coffee");
});

it("fetches once for a scan and purpose across ordinary rerenders, and keeps offer caveats", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(discovery([offer("Coffee beans", "https://merchant.example/beans", ["Check the roast variant.", "Stock varies by store."])])));
  vi.stubGlobal("fetch", fetcher);
  const { result, rerender } = renderHook(({ purpose }: { purpose: Purpose }) => useArShopping("stable-scan", purpose),
    { initialProps: { purpose: { kind: "self" } as Purpose } });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  rerender({ purpose: { kind: "self" } });
  rerender({ purpose: { kind: "self" } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.current.price).toBe("$12.99");
  expect(result.current.detail).toContain("Top match");
  expect(result.current.detail).toContain("Check the roast variant.");
  expect(result.current.detail).toContain("Stock varies by store.");
});

it("blocks an unsafe outbound offer URL", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(discovery([offer("Unsafe coffee", "javascript:alert(1)")]))));
  const { result } = renderHook(() => useArShopping("scan"));
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.url).toBeUndefined();
});

it("uses only HTTPS fallback search links when there are no priced offers", async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(discovery([], "https://www.google.com/search?tbm=shop&q=coffee")))
    .mockResolvedValueOnce(Response.json(discovery([], "data:text/html,bad")));
  vi.stubGlobal("fetch", fetcher);
  const { result, rerender } = renderHook(({ scanId }) => useArShopping(scanId), { initialProps: { scanId: "scan-a" } });
  await waitFor(() => expect(result.current.status).toBe("empty"));
  expect(result.current.url).toBe("https://www.google.com/search?tbm=shop&q=coffee");
  rerender({ scanId: "scan-b" });
  await waitFor(() => expect(result.current.status).toBe("empty"));
  expect(result.current.url).toBeUndefined();
});
