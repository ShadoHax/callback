import { afterEach, expect, it, vi } from "vitest";
import { discoverIngredientOffers } from "../src/lib/ar-shopping-discovery";

const originalSearchKey = process.env.SEARCHAPI_API_KEY;
const originalSerpKey = process.env.SERPAPI_API_KEY;
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSearchKey === undefined) delete process.env.SEARCHAPI_API_KEY;
  else process.env.SEARCHAPI_API_KEY = originalSearchKey;
  if (originalSerpKey === undefined) delete process.env.SERPAPI_API_KEY;
  else process.env.SERPAPI_API_KEY = originalSerpKey;
});

it("looks up each ingredient and excludes listings missing a required ingredient term", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  delete process.env.SERPAPI_API_KEY;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const query = new URL(String(input)).searchParams.get("q");
    return Response.json({ shopping_results: query === "baking soda" ? [
      { title: "Baking powder 16 oz", seller: "Grocer", extracted_price: 3.5, product_link: "https://merchant.example/powder" },
      { title: "Baking soda 16 oz", seller: "Grocer", extracted_price: 2.5, product_link: "https://merchant.example/soda" },
    ] : [
      { title: "Large brown eggs", seller: "Grocer", extracted_price: 4.25, product_link: "https://merchant.example/eggs" },
    ] });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await discoverIngredientOffers([
    { query: "baking soda", quantity: 1, reason: "Leavens the batter." },
    { query: "eggs", quantity: 2, reason: "Binds the batter." },
  ]);
  expect(result.allIngredientsHaveOffers).toBe(true);
  expect(result.ingredients.map((ingredient) => ingredient.offers.map((offer) => offer.title)))
    .toEqual([["Baking soda 16 oz"], ["Large brown eggs"]]);
  expect(result.ingredients[0].offers[0].price.amountCents).toBe(250);
  expect(result.ingredients[0].provider).toBe("searchapi");
  expect(result.ingredients[0].fallbackSearchUrl).toContain("baking%20soda");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("preserves missing-offer state instead of inventing a price", async () => {
  delete process.env.SEARCHAPI_API_KEY;
  delete process.env.SERPAPI_API_KEY;
  const result = await discoverIngredientOffers([{ query: "whole milk", quantity: 1, reason: "Adds liquid." }]);
  expect(result.allIngredientsHaveOffers).toBe(false);
  expect(result.ingredients[0].status).toBe("provider_unavailable");
  expect(result.ingredients[0].offers).toEqual([]);
  expect(result.ingredients[0].fallbackSearchUrl).toContain("whole%20milk");
});

it("rejects duplicate or malformed ingredient requirements", async () => {
  await expect(discoverIngredientOffers([
    { query: "eggs", quantity: 1, reason: "Binding" },
    { query: " Eggs ", quantity: 1, reason: "Binding" },
  ])).rejects.toThrow("distinct");
  await expect(discoverIngredientOffers([{ query: "https://bad.example", quantity: 1, reason: "Binding" }]))
    .rejects.toThrow("invalid");
});

it("cancels an in-flight provider request", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  delete process.env.SERPAPI_API_KEY;
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  vi.stubGlobal("fetch", fetcher);
  const pending = discoverIngredientOffers([{ query: "ground cardamom spice", quantity: 1, reason: "Adds flavor." }],
    { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("searches food names without packaging words and skips empty containers before choosing offers", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  delete process.env.SERPAPI_API_KEY;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const query = new URL(String(input)).searchParams.get("q");
    const shopping_results = query === "salt" ? [
      { title: "Salt Container with Lid", seller: "Shop", extracted_price: 1, product_link: "https://merchant.example/salt-container" },
      { title: "Salt Cellar", seller: "Shop", extracted_price: 2, product_link: "https://merchant.example/salt-cellar" },
      { title: "Salt Shaker", seller: "Shop", extracted_price: 3, product_link: "https://merchant.example/salt-shaker" },
      { title: "Sea Salt 26 oz", seller: "Grocer", extracted_price: 4, product_link: "https://merchant.example/salt" },
    ] : [
      { title: "Empty Glass Bottles for Vanilla Extract 2 oz", seller: "Shop", extracted_price: 2, product_link: "https://merchant.example/bottles" },
      { title: "Pure Vanilla Extract 2 fl oz Bottle", seller: "Grocer", extracted_price: 5, product_link: "https://merchant.example/vanilla" },
    ];
    return Response.json({ shopping_results });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await discoverIngredientOffers([
    { kind: "ingredient", query: "salt container", quantity: 1, reason: "Seasons the batter." },
    { kind: "ingredient", query: "vanilla extract bottle", quantity: 1, reason: "Adds flavor." },
  ]);
  expect(result.ingredients.map((item) => item.query)).toEqual(["salt", "vanilla extract"]);
  expect(result.ingredients.map((item) => item.requestedQuery)).toEqual(["salt container", "vanilla extract bottle"]);
  expect(result.ingredients.map((item) => item.offers.map((offer) => offer.title)))
    .toEqual([["Sea Salt 26 oz"], ["Pure Vanilla Extract 2 fl oz Bottle"]]);
  expect(fetcher.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("q")))
    .toEqual(["salt", "vanilla extract"]);
});

it("keeps equipment queries and products intact while removing only ripe from food queries", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  delete process.env.SERPAPI_API_KEY;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const query = new URL(String(input)).searchParams.get("q");
    return Response.json({ shopping_results: query === "salt container" ? [
      { title: "Salt Container with Lid", seller: "Shop", extracted_price: 12, product_link: "https://merchant.example/container" },
    ] : [
      { title: "Fresh Bananas", seller: "Grocer", extracted_price: 2, product_link: "https://merchant.example/bananas" },
    ] });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await discoverIngredientOffers([
    { kind: "equipment", query: "salt container", quantity: 1, reason: "Stores salt." },
    { kind: "ingredient", query: "ripe bananas", quantity: 2, reason: "Ripe fruit for the batter." },
  ]);
  expect(result.ingredients[0].query).toBe("salt container");
  expect(result.ingredients[0].offers[0].title).toBe("Salt Container with Lid");
  expect(result.ingredients[1].query).toBe("bananas");
  expect(result.ingredients[1].requestedQuery).toBe("ripe bananas");
});

it("reports no verified ingredient offer when only empty vessels match", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  delete process.env.SERPAPI_API_KEY;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ shopping_results: [
    { title: "Empty Glass Bottles for Almond Extract", seller: "Shop", extracted_price: 3, product_link: "https://merchant.example/empty" },
  ] })));
  const result = await discoverIngredientOffers([{ query: "almond extract bottle", quantity: 1, reason: "Adds flavor." }]);
  expect(result.ingredients[0].status).toBe("no_verified_offers");
  expect(result.ingredients[0].offers).toEqual([]);
  expect(result.allIngredientsHaveOffers).toBe(false);
});

it("rejects misleading edible-name matches and preserves explicit ingredient forms", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  delete process.env.SERPAPI_API_KEY;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ shopping_results: [
    { title: "Organic Banana Plant", seller: "Walmart", extracted_price: 10, product_link: "https://www.walmart.com/ip/plant" },
    { title: "Banana Chips", seller: "Walmart", extracted_price: 3, product_link: "https://www.walmart.com/ip/chips" },
    { title: "Fresh Banana Each", seller: "Walmart", extracted_price: .25, product_link: "https://www.walmart.com/ip/fruit" },
  ] })));
  const result = await discoverIngredientOffers([{ query: "organic banana", quantity: 1, reason: "Fruit for baking" }]);
  expect(result.ingredients[0].offers).toEqual([]);
});

it("uses alternative search wording without relaxing required title terms", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  delete process.env.SERPAPI_API_KEY;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    expect(new URL(String(input)).searchParams.get("q")).toBe("cane sugar Hy-Vee");
    return Response.json({ shopping_results: [
      { title: "Pure Cane Granulated White Sugar", seller: "Hy-Vee", extracted_price: 2.29, product_link: "https://www.hy-vee.com/sugar" },
      { title: "Sugar Cookies", seller: "Hy-Vee", extracted_price: 1, product_link: "https://www.hy-vee.com/cookies" },
    ] });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await discoverIngredientOffers([{ query: "granulated sugar", quantity: 1, reason: "Sweetener" }], { merchantQuery: "Hy-Vee", alternateTerms: true });
  expect(result.ingredients[0].offers.map(item => item.title)).toEqual(["Pure Cane Granulated White Sugar"]);
});
