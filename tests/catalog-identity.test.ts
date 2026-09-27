import { expect, it } from "vitest";
import { groundInCatalog as groundIn } from "../src/lib/commerce/catalog";
import { LEGACY_CATALOG } from "./fixtures/legacy-catalog";

const groundInCatalog = (observed: Parameters<typeof groundIn>[0]) => groundIn(observed, LEGACY_CATALOG);

it("keeps shopping grounded in the explicit title even when secondary image text names a different variant", () => {
  const matches = Object.fromEntries(groundInCatalog({ item: "Wingspan board game", title: "Wingspan", category: "board game",
    specificity: "exact_title", searchTerms: ["Wingspan Asia"], visibleText: ["Also try Wingspan Asia"] }).map((entry) => [entry.product.id, entry.match]));
  expect(matches["wingspan-base"]).toBe("same");
  expect(matches["wingspan-asia"]).toBe("family");
});

it("does not call the base product the same as a separate named edition", () => {
  const matches = groundInCatalog({ item: "Wingspan", title: "Wingspan", edition: "Deluxe Edition", category: "board game", specificity: "exact_title" });
  expect(matches.length).toBeGreaterThan(0);
  expect(matches.every((entry) => entry.match !== "same")).toBe(true);
});

it("does not ground an unrelated book in products named only by broad search terms", () => {
  expect(groundInCatalog({ item: "book", title: "Little Women", category: "book", specificity: "exact_title",
    searchTerms: ["Wingspan", "Fujifilm X100V"] })).toEqual([]);
});
