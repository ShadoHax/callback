import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/model", () => ({
  ModelError: class ModelError extends Error { constructor(message: string, readonly status?: number) { super(message); } },
  modelConfig: () => ({ provider: "meta", key: "test-key", base: "https://api.meta.ai/v1" }),
}));

import { searchNearbyPlaces } from "../src/lib/ar-nearby";

const result = (url: string, title: string) => ({ type: "text_result", url, title, snippet: "" });
function payload(text: string, options?: { searched?: boolean; status?: string; annotations?: object[]; results?: object[] }) {
  return { status: options?.status ?? "completed", output: [
    ...(options?.searched === false ? [] : [{ type: "web_search_call", status: "completed", results: options?.results ?? [] }]),
    { type: "message", status: "completed", content: [{ type: "output_text", text, annotations: options?.annotations ?? [] }] },
  ] };
}

describe("live nearby venue search", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("AR_NEARBY_MODEL", "");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("uses named fallback and returns only venues backed by actual search results", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload(
      "1. Blue Donkey Coffee | 350 Ferst Dr NW, Atlanta, GA 30332 | Coffee in the student center\n2. Imaginary Cafe | 123 Made Up St | Nice patio",
      { results: [result("https://example.com/blue-donkey", "Blue Donkey Coffee, 350 Ferst Dr NW, Atlanta, GA 30313")] }),
    });
    const nearby = await searchNearbyPlaces({ query: "coffee shops" });
    expect(nearby).toMatchObject({ query: "coffee shops", usedFallback: true, searched: true,
      locationLabel: "Klaus Advanced Computing Building, Georgia Tech, Atlanta, GA",
      places: [{ name: "Blue Donkey Coffee", url: "https://example.com/blue-donkey" }] });
    expect(nearby.places[0]).not.toHaveProperty("address"); // Source disagreed on ZIP.
    expect(nearby.places[0]).not.toHaveProperty("summary");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: "muse-spark-1.1", store: false, include: ["web_search_call.results"],
      tools: [{ type: "web_search", search_context_size: "low" }] });
    expect(body.input).toContain("Klaus Advanced Computing Building, Georgia Tech, Atlanta, GA");
    expect(nearby.url).toContain("coffee+shops+near+Klaus+Advanced+Computing+Building");
  });

  it("uses rounded, valid browser location in search and Maps URL", async () => {
    const text = "1. Dancing Goats Coffee | 33.776, -84.398 | On campus";
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload(text, { annotations: [
      { type: "url_citation", url: "https://example.com/dancing-goats", title: "Dancing Goats Coffee",
        start_index: 3, end_index: text.length },
    ], results: [result("https://example.com/dancing-goats", "Dancing Goats Coffee, 33.776, -84.398 on campus")] }) });
    const nearby = await searchNearbyPlaces({ query: "cafes", location: { latitude: 33.77591, longitude: -84.39812 } });
    expect(nearby).toMatchObject({ usedFallback: false, locationLabel: "Your current location",
      places: [{ name: "Dancing Goats Coffee", address: "33.776, -84.398", url: "https://example.com/dancing-goats" }] });
    expect(nearby.url).toContain("33.776%2C+-84.398");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).not.toContain("33.77591");
  });

  it("falls back from out-of-range coordinates without sending them", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload("1. Valid Cafe | 1 Main St | Coffee", {
      results: [result("https://example.com/cafe", "Valid Cafe, 1 Main St, Atlanta")],
    }) });
    const nearby = await searchNearbyPlaces({ query: "cafes", location: { latitude: 900, longitude: 1 } });
    expect(nearby.usedFallback).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).not.toContain("900");
  });

  it("ignores a citation to another venue and rejects a conflicting city", async () => {
    const first = "1. Blue Donkey Coffee | 350 Ferst Dr NW, Atlanta | Coffee";
    const second = "2. Dancing Goats Coffee | 1 Decatur St, Decatur | Coffee";
    const text = `${first}\n${second}`;
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload(text, { annotations: [
      { type: "url_citation", url: "https://example.com/perc", title: "Perc Coffee Atlanta", start_index: 3, end_index: first.length },
    ], results: [
      result("https://example.com/blue-donkey", "Blue Donkey Coffee, Atlanta"),
      result("https://example.com/decatur", "Dancing Goats Coffee, Decatur, Georgia"),
    ] }) });
    const nearby = await searchNearbyPlaces({ query: "coffee" });
    expect(nearby.places).toEqual([{ name: "Blue Donkey Coffee", url: "https://example.com/blue-donkey" }]);
  });

  it("rejects unsearched, incomplete, and uncited venue claims", async () => {
    const line = "1. Invented Cafe | 123 Fake St | Great";
    for (const response of [
      payload(line, { searched: false }),
      payload(line, { status: "incomplete" }),
      payload(line, { results: [result("https://example.com/irrelevant", "Other Place")] }),
    ]) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => response });
      await expect(searchNearbyPlaces({ query: "cafes" })).rejects.toThrow(/did not|no cited/);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects malformed queries before making a network request", async () => {
    await expect(searchNearbyPlaces({ query: "https://example.com" })).rejects.toThrow(/invalid/);
    await expect(searchNearbyPlaces({ query: "coffee\nshops" })).rejects.toThrow(/invalid/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
