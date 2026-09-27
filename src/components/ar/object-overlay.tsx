"use client";

import { containImageRect, layoutAnchoredCards, mapObjectBox, placeCardNearBox } from "@/lib/object-overlay";
import type { ArShoppingState } from "./ar-shopping";
import styles from "./object-overlay.module.css";

type NormalizedBox = { x: number; y: number; width: number; height: number };
export type ObjectOverlayProps = {
  imageWidth: number; imageHeight: number; viewportWidth: number; viewportHeight: number;
  box: NormalizedBox | null; label?: string; personName?: string; reason?: string;
  onOpen?: () => void; saving?: boolean; shopping?: ArShoppingState;
  fit?: "contain" | "cover"; compact?: boolean; outlineOnly?: boolean; testLabel?: string;
};

/** All coordinates use the displayed image rectangle, not the letterboxed viewport. */
export function ObjectOverlay({ imageWidth, imageHeight, viewportWidth, viewportHeight, box, label, personName, reason, onOpen, saving = false, shopping, fit = "contain", compact = false, outlineOnly = false, testLabel }: ObjectOverlayProps) {
  if (!box || imageWidth <= 0 || imageHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return null;
  let rect;
  try { rect = mapObjectBox(box, imageWidth, imageHeight, viewportWidth, viewportHeight, fit).rect; }
  catch { return null; }
  if (!rect) return null;
  const topInset = compact && fit === "cover" ? Math.min(80, viewportHeight * .15) : 0;
  const bottomInset = compact && fit === "cover" ? Math.min(110, viewportHeight * .2) : 0;
  const frame = fit === "cover" ? { x: 0, y: topInset, width: viewportWidth, height: Math.max(1, viewportHeight - topInset - bottomInset) } : containImageRect(imageWidth, imageHeight, viewportWidth, viewportHeight);
  if (compact) {
    // Keep the reminder readable instead of squeezing it into a narrow side gap.
    // Uploaded photos may use the letterbox space; the anchor still maps to the object.
    const margin = Math.min(12, viewportWidth / 8, viewportHeight / 8);
    const insets = { left: margin, right: margin, top: Math.max(margin, Math.min(80, viewportHeight * .15)), bottom: Math.max(margin, Math.min(110, viewportHeight * .2)) };
    const width = Math.min(310, viewportWidth - 2 * margin);
    const height = Math.min(personName || reason ? 88 : 52, viewportHeight - insets.top - insets.bottom);
    const position = { ...placeCardNearBox(rect, viewportWidth, viewportHeight, width, height, insets), width, height };
    const chip = <><span className={styles.compactAvatar} aria-hidden="true">{personName?.charAt(0) || "✦"}</span><span className={styles.compactText}>
      <span className={styles.compactHeading}>{personName || label || "Object in view"}{testLabel && <span className={styles.testBadge}>{testLabel}</span>}</span>
      {reason && <span className={styles.compactReason}>{reason}</span>}
    </span>{onOpen && <span className={styles.compactArrow} aria-hidden="true">↗</span>}</>;
    return <div className={styles.overlay} aria-label={`Object in view: ${label ?? "target"}`} role="group">
      <div className={styles.outline} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} aria-hidden="true">
        <span className={`${styles.corner} ${styles.topLeft}`} /><span className={`${styles.corner} ${styles.topRight}`} />
        <span className={`${styles.corner} ${styles.bottomLeft}`} /><span className={`${styles.corner} ${styles.bottomRight}`} />
      </div>
      {outlineOnly ? null : onOpen ? <button className={styles.compactCard} data-ar-card="connection" data-edge={position.placement} style={{ left: position.x, top: position.y, width: position.width, height: position.height }} type="button" onClick={onOpen} disabled={saving} aria-label={`Open ${personName || label || "connection"}`}>{chip}</button>
        : <div className={styles.compactCard} data-ar-card="connection" data-edge={position.placement} style={{ left: position.x, top: position.y, width: position.width, height: position.height }}>{chip}</div>}
    </div>;
  }
  const width = Math.min(240, frame.width * .48);
  const sizes = [{ width, height: personName ? 174 : 44 }, ...(shopping ? [{ width, height: 156 }] : [])];
  const positions = layoutAnchoredCards(rect, frame, sizes, 8);
  const cardStyle = (index: number) => ({ left: positions[index].x, top: positions[index].y, width: positions[index].width, height: positions[index].height });
  let safeUrl: string | undefined;
  try { if (shopping?.url && new URL(shopping.url).protocol === "https:") safeUrl = shopping.url; } catch {}
  return <div className={styles.overlay} aria-label={`Object in view: ${label ?? "target"}`} role="group">
    <div className={styles.outline} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} aria-hidden="true">
      <span className={`${styles.corner} ${styles.topLeft}`} /><span className={`${styles.corner} ${styles.topRight}`} />
      <span className={`${styles.corner} ${styles.bottomLeft}`} /><span className={`${styles.corner} ${styles.bottomRight}`} />
    </div>
    <div className={styles.card} data-ar-card="connection" data-edge={positions[0].placement} style={cardStyle(0)}>
      <p className={styles.label}>{label}{personName ? " · reminds you of" : " · in view"}</p>
      {personName && <h2 className={styles.person}>{personName}</h2>}
      {reason && <p className={styles.reason}>{reason}</p>}
      {personName && onOpen && <button className={styles.open} type="button" onClick={onOpen} disabled={saving}>{saving ? "Opening…" : "Open connection"}<span aria-hidden="true">↗</span></button>}
    </div>
    {shopping && <div className={`${styles.card} ${styles.shop}`} data-ar-card="shopping" data-edge={positions[1].placement} style={cardStyle(1)} aria-live="polite">
      <p className={styles.label}>{shopping.status === "loading" ? "Finding an option…" : shopping.status === "ready" ? "Top shopping match" : "Explore options"}</p>
      {shopping.title && <h3 className={styles.product}>{shopping.title}</h3>}
      {(shopping.price || shopping.merchant) && <p className={styles.reason}>{[shopping.price, shopping.merchant].filter(Boolean).join(" · ")}</p>}
      {safeUrl && <a className={styles.open} href={safeUrl} target="_blank" rel="noopener noreferrer">{shopping.status === "ready" ? "View offer" : "Search products"}<span aria-hidden="true">↗</span></a>}
      {shopping.detail && <p className={styles.note}>{shopping.detail}</p>}
    </div>}
  </div>;
}
