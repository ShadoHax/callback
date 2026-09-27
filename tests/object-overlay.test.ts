import { describe, expect, it } from "vitest";
import { containImageRect, layoutAnchoredCards, mapObjectBox, placeCardNearBox, validateNormalizedBox,
  type PixelRect } from "../src/lib/object-overlay";

function inside(card: PixelRect, frame: PixelRect) {
  expect(card.x).toBeGreaterThanOrEqual(frame.x - 0.001);
  expect(card.y).toBeGreaterThanOrEqual(frame.y - 0.001);
  expect(card.x + card.width).toBeLessThanOrEqual(frame.x + frame.width + 0.001);
  expect(card.y + card.height).toBeLessThanOrEqual(frame.y + frame.height + 0.001);
}

function doNotOverlap(first: PixelRect, second: PixelRect) {
  expect(first.x + first.width <= second.x || second.x + second.width <= first.x
    || first.y + first.height <= second.y || second.y + second.height <= first.y).toBe(true);
}

describe("object box geometry", () => {
  it("maps portrait source boxes through contain letterboxing", () => {
    const mapped = mapObjectBox({ x: 0.25, y: 0.2, width: 0.5, height: 0.4 }, 1200, 1800, 1000, 1000, "contain");
    expect(mapped.visible).toBe(true);
    expect(mapped.clipped).toBe(false);
    expect(mapped.rect?.x).toBeCloseTo(333.333);
    expect(mapped.rect?.y).toBeCloseTo(200);
    expect(mapped.rect?.width).toBeCloseTo(333.333);
    expect(mapped.rect?.height).toBeCloseTo(400);
  });

  it("maps a landscape source through cover and reports a clipped edge object", () => {
    const mapped = mapObjectBox({ x: 0.3, y: 0.2, width: 0.25, height: 0.4 }, 1920, 1080, 390, 844, "cover");
    expect(mapped.visible).toBe(true);
    expect(mapped.clipped).toBe(true);
    expect(mapped.unclipped.x).toBeLessThan(0);
    expect(mapped.unclipped.x).toBeCloseTo(-105.089);
    expect(mapped.rect?.x).toBe(0);
    expect(mapped.rect?.width).toBeCloseTo(270.022);
    expect(mapped.rect?.width).toBeLessThan(mapped.unclipped.width);
    expect(mapped.rect?.y).toBeCloseTo(168.8);
    expect(mapped.rect?.height).toBeCloseTo(337.6);
  });

  it("marks a fully cropped object offscreen rather than fabricating a visible box", () => {
    const mapped = mapObjectBox({ x: 0, y: 0.2, width: 0.1, height: 0.4 }, 1920, 1080, 390, 844, "cover");
    expect(mapped).toMatchObject({ rect: null, clipped: true, visible: false });
  });

  it("maps a portrait source into a landscape cover viewport and handles a square fit", () => {
    const cropped = mapObjectBox({ x: 0.25, y: 0, width: 0.5, height: 0.3 }, 1080, 1920, 844, 390, "cover");
    expect(cropped).toMatchObject({ rect: null, clipped: true, visible: false });
    const square = mapObjectBox({ x: 0.2, y: 0.3, width: 0.4, height: 0.5 }, 1000, 1000, 500, 500, "contain");
    expect(square).toEqual({
      rect: { x: 100, y: 150, width: 200, height: 250 },
      unclipped: { x: 100, y: 150, width: 200, height: 250 },
      clipped: false, visible: true,
    });
  });

  it("rejects absent, invalid, and out-of-image boxes", () => {
    expect(() => validateNormalizedBox(null)).toThrow(/missing or malformed/);
    expect(() => validateNormalizedBox({ x: 0, y: 0, width: 0, height: 0.5 })).toThrow(/fit within/);
    expect(() => validateNormalizedBox({ x: 0.8, y: 0, width: 0.3, height: 0.5 })).toThrow(/fit within/);
    expect(() => validateNormalizedBox({ x: 0, y: Number.NaN, width: 0.2, height: 0.5 })).toThrow(/finite/);
    expect(() => mapObjectBox({ x: 0, y: 0, width: 1, height: 1 }, 0, 100, 100, 100, "contain")).toThrow(/Source width/);
  });
});

describe("card placement", () => {
  it("prefers the right side, then left, without leaving the viewport", () => {
    expect(placeCardNearBox({ x: 120, y: 100, width: 80, height: 80 }, 600, 400, 160, 100))
      .toEqual({ x: 212, y: 90, placement: "right" });
    expect(placeCardNearBox({ x: 500, y: 100, width: 80, height: 80 }, 600, 400, 160, 100))
      .toEqual({ x: 328, y: 90, placement: "left" });
  });

  it("keeps a card within reserved header and controls insets", () => {
    const placed = placeCardNearBox({ x: 200, y: 165, width: 440, height: 80 }, 844, 390, 220, 160,
      { top: 72, right: 12, bottom: 110, left: 12 });
    expect(placed.x).toBeGreaterThanOrEqual(12);
    expect(placed.x + 220).toBeLessThanOrEqual(832);
    expect(placed.y).toBeGreaterThanOrEqual(72);
    expect(placed.y + 160).toBeLessThanOrEqual(280);
  });

  it("rejects a card or anchor that cannot fit", () => {
    expect(() => placeCardNearBox({ x: 0, y: 0, width: 20, height: 20 }, 100, 100, 120, 40)).toThrow(/does not fit/);
    expect(() => placeCardNearBox({ x: -1, y: 0, width: 20, height: 20 }, 100, 100, 40, 40)).toThrow(/visible box/);
    expect(() => placeCardNearBox({ x: 0, y: 0, width: 20, height: 20 }, 100, 100, 40, 40, -2)).toThrow(/margins/);
  });
});

describe("cards anchored inside the image", () => {
  it("returns the portrait and landscape letterboxed image rectangles", () => {
    const portrait = containImageRect(1080, 1920, 1000, 600);
    expect(portrait.x).toBeCloseTo(331.25);
    expect(portrait.y).toBe(0);
    expect(portrait.width).toBeCloseTo(337.5);
    expect(portrait.height).toBe(600);
    const landscape = containImageRect(1920, 1080, 600, 1000);
    expect(landscape.x).toBe(0);
    expect(landscape.y).toBeCloseTo(331.25);
    expect(landscape.width).toBe(600);
    expect(landscape.height).toBeCloseTo(337.5);
    expect(() => containImageRect(0, 100, 100, 100)).toThrow(/Source width/);
  });

  it("keeps both cards inside a portrait image instead of its side letterboxes", () => {
    const frame = containImageRect(1080, 1920, 1000, 600);
    const cards = layoutAnchoredCards({ x: 410, y: 180, width: 55, height: 100 }, frame,
      [{ width: 130, height: 90 }, { width: 150, height: 110 }]);
    expect(cards).toHaveLength(2);
    cards.forEach((card) => inside(card, frame));
    doNotOverlap(cards[0], cards[1]);
    expect(cards[0].placement).toBe("right");
  });

  it("keeps both cards inside a landscape image instead of its top and bottom letterboxes", () => {
    const frame = containImageRect(1920, 1080, 600, 1000);
    const cards = layoutAnchoredCards({ x: 400, y: 400, width: 50, height: 80 }, frame,
      [{ width: 160, height: 70 }, { width: 180, height: 80 }]);
    expect(cards.map((card) => card.placement)).toEqual(["left", "left"]);
    cards.forEach((card) => inside(card, frame));
    doNotOverlap(cards[0], cards[1]);
  });

  it("flips a two-card stack from right to left as the object reaches the image edge", () => {
    const frame = { x: 100, y: 50, width: 600, height: 400 };
    const sizes = [{ width: 180, height: 100 }, { width: 200, height: 120 }];
    const right = layoutAnchoredCards({ x: 250, y: 180, width: 80, height: 100 }, frame, sizes);
    const left = layoutAnchoredCards({ x: 610, y: 180, width: 80, height: 100 }, frame, sizes);
    expect(right.map((card) => card.placement)).toEqual(["right", "right"]);
    expect(left.map((card) => card.placement)).toEqual(["left", "left"]);
    for (const cards of [right, left]) {
      cards.forEach((card) => inside(card, frame));
      doNotOverlap(cards[0], cards[1]);
      expect(cards.every((card) => !card.scroll)).toBe(true);
    }
  });

  it("uses below or above when a broad object leaves no side room", () => {
    const frame = { x: 0, y: 0, width: 500, height: 500 };
    const sizes = [{ width: 200, height: 80 }, { width: 200, height: 80 }];
    const below = layoutAnchoredCards({ x: 50, y: 60, width: 400, height: 80 }, frame, sizes);
    const above = layoutAnchoredCards({ x: 50, y: 350, width: 400, height: 80 }, frame, sizes);
    expect(below.map((card) => card.placement)).toEqual(["below", "below"]);
    expect(above.map((card) => card.placement)).toEqual(["above", "above"]);
    for (const cards of [below, above]) { cards.forEach((card) => inside(card, frame)); doNotOverlap(cards[0], cards[1]); }
  });

  it("shrinks long cards for scrolling and remains valid on a tiny image", () => {
    const short = { x: 0, y: 0, width: 500, height: 160 };
    const longCards = layoutAnchoredCards({ x: 100, y: 60, width: 80, height: 40 }, short,
      [{ width: 140, height: 200 }, { width: 160, height: 180 }]);
    longCards.forEach((card) => { inside(card, short); expect(card.scroll).toBe(true); });
    doNotOverlap(longCards[0], longCards[1]);

    const tiny = { x: 50, y: 100, width: 90, height: 60 };
    const tinyCards = layoutAnchoredCards({ x: 80, y: 120, width: 20, height: 15 }, tiny,
      [{ width: 200, height: 180 }, { width: 180, height: 220 }]);
    expect(tinyCards).toHaveLength(2);
    tinyCards.forEach((card) => { inside(card, tiny); expect(card.width).toBeGreaterThan(0); expect(card.height).toBeGreaterThan(0); });
    doNotOverlap(tinyCards[0], tinyCards[1]);
  });
});
