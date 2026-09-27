import { expect, it } from "vitest";
import type { Identification } from "../src/lib/decision";
import { compareProductIdentity } from "../src/lib/product-identity";

const photo = (title: string, edition = "", item = title, category = "board game"): Identification => ({
  title, edition, item, category, specificity: "exact_title", visibleText: [title], searchTerms: [title], ambiguity: "",
});

it.each([
  ["Ticket to Ride", photo("Ticket to Ride: Rails and Sails"), "different"],
  ["Wingspan", photo("Wingspan Asia"), "different"],
  ["Wingspan Asia", photo("Wingspan Asia"), "same"],
  ["Wingspan", photo("Wingspan", "Deluxe Edition"), "different"],
  ["Wingspan Deluxe Edition", photo("Wingspan", "Deluxe Edition"), "same"],
  ["Wingspan", photo("Wingspan", "2nd Edition"), "different"],
  ["Wingspan 2nd Edition", photo("Wingspan", "2nd Edition"), "same"],
  ["Wingspan", photo("Wingspan", "2nd printing"), "same"],
  ["Blonde", photo("Blonde", "Anniversary Edition", "Blonde vinyl record", "vinyl record"), "different"],
  ["X100V", photo("Fujifilm X100VI", "", "Fujifilm X100VI", "camera"), "different"],
  ["Fuji X100-series camera", photo("Fujifilm X100V", "", "Fujifilm X100V", "camera"), "family"],
  ["Nikon Zf", photo("Fujifilm X100V", "", "Fujifilm X100V", "camera"), "unrelated"],
  ["Wingspan", photo("Wingspan Asia", "", "Wingspan base game"), "different"],
] as const)("classifies %s against %s as %s", (mention, identification, expected) => {
  expect(compareProductIdentity(mention, identification)).toBe(expected);
});
