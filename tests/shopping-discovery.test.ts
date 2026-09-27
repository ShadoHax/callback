import { afterEach, expect, it, vi } from "vitest";
import { discover } from "../src/lib/commerce/discovery";
import type { ScanContext } from "../src/lib/commerce/options";

const context: ScanContext = { observed: { item: "coffee beans", category: "coffee", specificity: "category" }, connection: null, advice: [] };
const originalKey = process.env.SERPAPI_API_KEY;
const originalSearchKey = process.env.SEARCHAPI_API_KEY;
afterEach(() => { vi.unstubAllGlobals(); if (originalKey === undefined) delete process.env.SERPAPI_API_KEY; else process.env.SERPAPI_API_KEY = originalKey; if (originalSearchKey === undefined) delete process.env.SEARCHAPI_API_KEY; else process.env.SEARCHAPI_API_KEY = originalSearchKey; });

it("normalizes and ranks priced SerpApi offers without private profile data", async () => {
  delete process.env.SEARCHAPI_API_KEY;
  process.env.SERPAPI_API_KEY = "test-key";
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ shopping_results: [
    { title: "Coffee beans light roast", source: "Merchant A", extracted_price: 18.99, link: "https://merchant.example/coffee", thumbnail: "https://merchant.example/coffee.jpg" },
    { title: "Unrelated lamp", source: "Merchant B", extracted_price: 12, link: "https://merchant.example/lamp" },
    { title: "Coffee beans dark roast", source: "Merchant C", price: "Not priced", link: "https://merchant.example/dark" },
  ] }));
  vi.stubGlobal("fetch", fetcher);
  const result = await discover(context, { purpose: { kind: "self" } });
  expect(result.status).toBe("ok");
  expect(result.offers).toHaveLength(1);
  expect(result.offers[0].price.amountCents).toBe(1899);
  expect(result.offers[0].merchantUrl).toBe("https://merchant.example/coffee");
  expect(String(fetcher.mock.calls[0][0])).toContain("engine=google_shopping");
});

it("uses SearchApi when configured and excludes installment prices", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  delete process.env.SERPAPI_API_KEY;
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ shopping_results: [
    { title: "Coffee beans light roast", seller: "Merchant A", extracted_price: 18.99, product_link: "https://www.google.com/shopping/product/123" },
    { title: "Coffee beans on payment plan", seller: "Merchant B", extracted_price: 10, product_link: "https://www.google.com/shopping/product/456", installment: { months: 12 } },
  ] }));
  vi.stubGlobal("fetch", fetcher);
  const result = await discover(context, { purpose: { kind: "self" } });
  expect(result.provider).toBe("searchapi");
  expect(result.offers).toHaveLength(1);
  expect(result.offers[0].price.amountCents).toBe(1899);
  expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer test-key" });
});

it("retains SerpApi shopping results that provide a Google product link", async () => {
  delete process.env.SEARCHAPI_API_KEY;
  process.env.SERPAPI_API_KEY = "test-key";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ shopping_results: [
    { title: "Coffee beans medium roast", source: "Merchant A", extracted_price: 12,
      product_link: "https://www.google.com/shopping/product/123" },
  ] })));
  const result = await discover({ ...context, observed: { item: "medium roast coffee beans", specificity: "category" } }, { purpose: { kind: "self" } });
  expect(result.offers[0].merchantUrl).toBe("https://www.google.com/shopping/product/123");
  expect(result.offers[0].caveats).toContain("Opens a Google Shopping listing; choose and verify the merchant there.");
});

it("returns a search link when providers are not configured", async () => {
  delete process.env.SERPAPI_API_KEY;
  delete process.env.SEARCHAPI_API_KEY;
  const result = await discover(context, { purpose: { kind: "self" } });
  expect(result.status).toBe("provider_unavailable");
  expect(result.offers).toEqual([]);
  expect(result.fallbackSearchUrl).toContain("google.com/search");
});

it("reuses public provider results for an identical query", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  delete process.env.SERPAPI_API_KEY;
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ shopping_results: [
    { title: "Decaf espresso whole bean coffee", seller: "Coffee Shop", extracted_price: 15, product_link: "https://www.google.com/shopping/product/789" },
  ] }));
  vi.stubGlobal("fetch", fetcher);
  const decaf: ScanContext = { ...context, observed: { item: "decaf espresso whole bean coffee", specificity: "category" } };
  await discover(decaf, { purpose: { kind: "self" } });
  await discover(decaf, { purpose: { kind: "self" } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("searches a gift recipient's light-roast preference instead of dark-roast photo details", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  delete process.env.SERPAPI_API_KEY;
  const gift: ScanContext = {
    observed: { item: "dark roast coffee beans", category: "coffee", specificity: "exact_title", title: "Dark Roast Coffee Beans" },
    connection: { personId: "maya", relation: "prefers", mention: "light-roast whole beans", caveats: [], preferences: { likes: ["light-roast whole beans"], avoids: ["dark roasts"] } },
    advice: [],
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ shopping_results: [
    { title: "Light Roast Whole Bean Coffee", seller: "Shop A", extracted_price: 18, product_link: "https://merchant.example/light" },
    { title: "Dark Roast Whole Bean Coffee", seller: "Shop B", extracted_price: 16, product_link: "https://merchant.example/dark" },
  ] }));
  vi.stubGlobal("fetch", fetcher);
  const result = await discover(gift, { purpose: { kind: "gift", personId: "maya" } });
  expect(result.query).toBe("light roast whole bean coffee");
  expect(result.fallbackSearchUrl).toContain("light%20roast%20whole%20bean%20coffee");
  expect(result.offers.map((offer) => offer.title)).toEqual(["Light Roast Whole Bean Coffee"]);
  const providerQuery = new URL(String(fetcher.mock.calls[0][0])).searchParams.get("q");
  expect(providerQuery).toBe(result.query);
  expect(providerQuery).not.toMatch(/dark|maya/i);
  const self = await discover(gift, { purpose: { kind: "self" } });
  expect(self.query).toBe("Dark Roast Coffee Beans");
});
