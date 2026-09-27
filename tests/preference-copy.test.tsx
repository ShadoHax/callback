// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { draftFor } from "../src/components/composer";
import { ConnectionCard } from "../src/components/connection";
import type { ScanResult } from "../src/lib/scan-types";

const related: ScanResult = {
  scanId: "soda-shelf", status: "matched", person: "alan", personName: "Alan", relation: "prefers",
  mention: "zero sugar sodas", category: "soda", observedEntity: "soda shelf", preferenceMatch: "related",
  reason: "Alan told you they like “zero sugar sodas”.", whyNow: "A small gift they'd actually enjoy.",
};

beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("preference copy", () => {
  it("drafts a related soda reminder without saying zero-sugar soda was spotted", () => {
    const draft = draftFor(related);
    expect(draft).toBe("I came across soda and thought of you. How have you been?");
    expect(draft).not.toMatch(/zero sugar|spotted/i);
  });

  it("does not say an unconfirmed named preference was spotted", () => {
    const draft = draftFor({ relation: "prefers", mention: "diet coke", category: "soda", observedEntity: "regular Coca-Cola and Pepsi cans" });
    expect(draft).toBe("I came across soda and thought of you. How have you been?");
    expect(draft).not.toMatch(/diet coke|spotted/i);
  });

  it("can name the preferred product when its identity was confirmed", () => {
    expect(draftFor({ relation: "prefers", mention: "Diet Coke", preferenceMatch: "observed", category: "soda" }))
      .toBe("I spotted Diet Coke and thought of you. Still a favorite?");
  });

  it("explains a related taste on the connection card without implying the pictured variety matches", () => {
    render(<ConnectionCard result={related} />);
    expect(screen.getByText(/Related taste, not a confirmed product match/)).toBeTruthy();
    expect(screen.getByText(/doesn't confirm the preferred variety is shown/)).toBeTruthy();
    expect(screen.getByText("A reason to check in, or look for a gift that actually matches their taste.")).toBeTruthy();
    expect(screen.queryByText("A small gift they'd actually enjoy.")).toBeNull();
  });

  it("omits the related-taste caveat when a named preference is observed", () => {
    render(<ConnectionCard result={{ ...related, person: "agarwal", personName: "Agarwal", mention: "Diet Coke", preferenceMatch: "observed" }} />);
    expect(screen.queryByText(/Related taste, not a confirmed product match/)).toBeNull();
  });
});
