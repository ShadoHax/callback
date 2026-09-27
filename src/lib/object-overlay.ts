/** Detector coordinates are fractions of the original, upright image. */
export type NormalizedBox = { x: number; y: number; width: number; height: number };
export type PixelRect = { x: number; y: number; width: number; height: number };
export type ObjectFit = "contain" | "cover";
export type MappedObjectBox = {
  /** The visible intersection in viewport pixels; null when cover cropping hides the object entirely. */
  rect: PixelRect | null;
  /** The box before viewport clipping, useful for knowing how much was cropped. */
  unclipped: PixelRect;
  clipped: boolean;
  visible: boolean;
};
export type CardInsets = { top: number; right: number; bottom: number; left: number };
export type CardPlacement = { x: number; y: number; placement: "right" | "left" | "below" | "above" };
export type AnchoredCard = PixelRect & { placement: CardPlacement["placement"]; scroll: boolean };

function positive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive, finite number.`);
}

/** Reject malformed model coordinates instead of silently shifting the target. */
export function validateNormalizedBox(value: unknown): NormalizedBox {
  if (!value || typeof value !== "object") throw new Error("Object box is missing or malformed.");
  const box = value as Partial<NormalizedBox>;
  if (![box.x, box.y, box.width, box.height].every((part) => typeof part === "number" && Number.isFinite(part))) {
    throw new Error("Object box must contain finite x, y, width, and height numbers.");
  }
  const { x, y, width, height } = box as NormalizedBox;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new Error("Object box must fit within normalized image coordinates.");
  }
  return { x, y, width, height };
}

/** Map an original-image box through centered CSS object-fit into viewport pixels. */
export function mapObjectBox(
  box: NormalizedBox,
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  fit: ObjectFit,
): MappedObjectBox {
  const valid = validateNormalizedBox(box);
  positive(sourceWidth, "Source width"); positive(sourceHeight, "Source height");
  positive(viewportWidth, "Viewport width"); positive(viewportHeight, "Viewport height");
  if (fit !== "contain" && fit !== "cover") throw new Error("Object fit must be contain or cover.");

  const scaleX = viewportWidth / sourceWidth;
  const scaleY = viewportHeight / sourceHeight;
  const scale = fit === "contain" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (viewportWidth - renderedWidth) / 2;
  const offsetY = (viewportHeight - renderedHeight) / 2;
  const unclipped = {
    x: offsetX + valid.x * renderedWidth,
    y: offsetY + valid.y * renderedHeight,
    width: valid.width * renderedWidth,
    height: valid.height * renderedHeight,
  };
  const left = Math.max(0, unclipped.x);
  const top = Math.max(0, unclipped.y);
  const right = Math.min(viewportWidth, unclipped.x + unclipped.width);
  const bottom = Math.min(viewportHeight, unclipped.y + unclipped.height);
  const clipped = unclipped.x < 0 || unclipped.y < 0
    || unclipped.x + unclipped.width > viewportWidth || unclipped.y + unclipped.height > viewportHeight;
  const visible = right > left && bottom > top;
  return {
    rect: visible ? { x: left, y: top, width: right - left, height: bottom - top } : null,
    unclipped,
    clipped,
    visible,
  };
}

function cardInsets(margin: number | CardInsets): CardInsets {
  const insets = typeof margin === "number"
    ? { top: margin, right: margin, bottom: margin, left: margin }
    : margin;
  if (!insets || [insets.top, insets.right, insets.bottom, insets.left]
    .some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Card margins must be finite, nonnegative numbers.");
  }
  return insets;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Place a card beside a visible box while respecting viewport or UI chrome insets. */
export function placeCardNearBox(
  box: PixelRect,
  viewportWidth: number,
  viewportHeight: number,
  cardWidth: number,
  cardHeight: number,
  margin: number | CardInsets = 12,
): CardPlacement {
  positive(viewportWidth, "Viewport width"); positive(viewportHeight, "Viewport height");
  positive(cardWidth, "Card width"); positive(cardHeight, "Card height");
  const insets = cardInsets(margin);
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)
    || box.width <= 0 || box.height <= 0 || box.x < 0 || box.y < 0
    || box.x + box.width > viewportWidth || box.y + box.height > viewportHeight) {
    throw new Error("Card anchor must be a visible box inside the viewport.");
  }
  const minX = insets.left;
  const maxX = viewportWidth - insets.right - cardWidth;
  const minY = insets.top;
  const maxY = viewportHeight - insets.bottom - cardHeight;
  if (maxX < minX || maxY < minY) throw new Error("Card does not fit within the available viewport.");

  const gap = 12;
  const centerX = box.x + box.width / 2 - cardWidth / 2;
  const centerY = box.y + box.height / 2 - cardHeight / 2;
  const rightX = box.x + box.width + gap;
  const leftX = box.x - gap - cardWidth;
  const belowY = box.y + box.height + gap;
  const aboveY = box.y - gap - cardHeight;
  if (rightX <= maxX) return { x: rightX, y: clamp(centerY, minY, maxY), placement: "right" };
  if (leftX >= minX) return { x: leftX, y: clamp(centerY, minY, maxY), placement: "left" };
  if (belowY <= maxY) return { x: clamp(centerX, minX, maxX), y: belowY, placement: "below" };
  if (aboveY >= minY) return { x: clamp(centerX, minX, maxX), y: aboveY, placement: "above" };

  // When no side fits without overlap, use the side with the most room and keep the whole card visible.
  const options = [
    { placement: "right" as const, room: (maxX - rightX) / cardWidth, x: rightX, y: centerY },
    { placement: "left" as const, room: (leftX - minX) / cardWidth, x: leftX, y: centerY },
    { placement: "below" as const, room: (maxY - belowY) / cardHeight, x: centerX, y: belowY },
    { placement: "above" as const, room: (aboveY - minY) / cardHeight, x: centerX, y: aboveY },
  ];
  const best = options.reduce((current, option) => option.room > current.room ? option : current);
  return { x: clamp(best.x, minX, maxX), y: clamp(best.y, minY, maxY), placement: best.placement };
}

/** The actual image area in a viewport displaying it with object-fit: contain. */
export function containImageRect(sourceWidth: number, sourceHeight: number, viewportWidth: number, viewportHeight: number): PixelRect {
  positive(sourceWidth, "Source width"); positive(sourceHeight, "Source height");
  positive(viewportWidth, "Viewport width"); positive(viewportHeight, "Viewport height");
  const scale = Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (viewportWidth - width) / 2, y: (viewportHeight - height) / 2, width, height };
}

/** Place several cards together near a tracked object, entirely inside the visible image. */
export function layoutAnchoredCards(
  box: PixelRect,
  frame: PixelRect,
  sizes: { width: number; height: number }[],
  gap = 12,
): AnchoredCard[] {
  if (!frame || !Number.isFinite(frame.x) || !Number.isFinite(frame.y)) throw new Error("Image frame must have finite coordinates.");
  positive(frame.width, "Image frame width"); positive(frame.height, "Image frame height");
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)
    || box.width <= 0 || box.height <= 0) throw new Error("Object box must be a positive, finite rectangle.");
  if (!Number.isFinite(gap) || gap < 0) throw new Error("Card gap must be a finite, nonnegative number.");
  if (!Array.isArray(sizes)) throw new Error("Card sizes must be an array.");
  for (const size of sizes) { positive(size?.width, "Card width"); positive(size?.height, "Card height"); }
  if (!sizes.length) return [];

  // Reduce the edge inset on tiny images so there is always a usable inner rectangle.
  const margin = Math.min(gap, frame.width / 4, frame.height / 4);
  const nearGap = Math.min(gap, frame.width / 8, frame.height / 8);
  const inner = { left: frame.x + margin, top: frame.y + margin,
    right: frame.x + frame.width - margin, bottom: frame.y + frame.height - margin };
  const desiredWidth = Math.max(...sizes.map((size) => size.width));
  const desiredHeight = sizes.reduce((sum, size) => sum + size.height, 0) + gap * (sizes.length - 1);
  type Side = CardPlacement["placement"];
  type Region = { side: Side; left: number; top: number; right: number; bottom: number; width: number; height: number };
  const candidates: Omit<Region, "width" | "height">[] = [
    { side: "right", left: clamp(box.x + box.width + nearGap, inner.left, inner.right), top: inner.top, right: inner.right, bottom: inner.bottom },
    { side: "left", left: inner.left, top: inner.top, right: clamp(box.x - nearGap, inner.left, inner.right), bottom: inner.bottom },
    { side: "below", left: inner.left, top: clamp(box.y + box.height + nearGap, inner.top, inner.bottom), right: inner.right, bottom: inner.bottom },
    { side: "above", left: inner.left, top: inner.top, right: inner.right, bottom: clamp(box.y - nearGap, inner.top, inner.bottom) },
  ];
  const regions: Region[] = candidates.map((region) => ({ ...region,
    width: Math.max(0, region.right - region.left), height: Math.max(0, region.bottom - region.top) }));
  const fullFit = regions.find((region) => region.width >= desiredWidth && region.height >= desiredHeight);
  const viable = regions.filter((region) => region.width > 0 && region.height > 0);
  const best = viable.reduce<Region | null>((current, region) => {
    if (!current) return region;
    const score = (value: Region) => Math.min(1, value.width / desiredWidth) * Math.min(1, value.height / desiredHeight);
    return score(region) > score(current) ? region : current;
  }, null);
  const score = best ? Math.min(1, best.width / desiredWidth) * Math.min(1, best.height / desiredHeight) : 0;
  const region: Region = fullFit ?? (best && score >= 0.28 ? best : {
    side: "below", ...inner, width: inner.right - inner.left, height: inner.bottom - inner.top,
  });
  const groupWidth = Math.min(desiredWidth, region.width);
  const groupHeight = Math.min(desiredHeight, region.height);
  const between = sizes.length > 1 ? Math.min(gap, groupHeight / (sizes.length * 4)) : 0;
  const requestedHeight = sizes.reduce((sum, size) => sum + size.height, 0);
  const heightScale = Math.min(1, (groupHeight - between * (sizes.length - 1)) / requestedHeight);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const groupX = region.side === "right" ? region.left
    : region.side === "left" ? region.right - groupWidth
      : clamp(centerX - groupWidth / 2, region.left, region.right - groupWidth);
  const groupY = region.side === "below" ? region.top
    : region.side === "above" ? region.bottom - groupHeight
      : clamp(centerY - groupHeight / 2, region.top, region.bottom - groupHeight);
  let y = groupY;
  return sizes.map((size) => {
    const width = Math.min(size.width, groupWidth);
    const height = size.height * heightScale;
    const x = region.side === "left" ? groupX + groupWidth - width
      : region.side === "right" ? groupX : groupX + (groupWidth - width) / 2;
    const card = { x, y, width, height, placement: region.side, scroll: height < size.height - 0.5 };
    y += height + between;
    return card;
  });
}
