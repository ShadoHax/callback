import type { Observed } from "./catalog";

export type SoftwareInfo = {
  title: string;
  kind: "software";
  description: string;
  price: "Free from Sony";
  downloadUrl: string;
  supportUrl: string;
  compatibility: string[];
  source: "Sony";
};

export type LiveSearchResult = {
  query: string;
  searchUrl: string;
  shoppingUrl: string;
  software: SoftwareInfo | null;
  message: string;
};

export function isSonyWebcamSoftware(observed: Observed) {
  const terms = [observed.title, observed.item, ...(observed.searchTerms ?? [])].filter(Boolean).join(" ").toLowerCase();
  return /imaging\s+edge\s+webcam/.test(terms);
}

function productSoftwareInfo(observed: Observed): SoftwareInfo | null {
  if (!isSonyWebcamSoftware(observed)) return null;
  return {
    title: "Imaging Edge Webcam",
    kind: "software",
    description: "Sony desktop software that lets a supported Sony camera work as a high-quality webcam. Sony says it does not handle camera microphone audio.",
    price: "Free from Sony",
    downloadUrl: "https://support.d-imaging.sony.co.jp/app/webcam/l/download/",
    supportUrl: "https://www.sony.com/electronics/support/articles/00247038",
    compatibility: [
      "Sony camera support varies by model; check Sony’s confirmed camera list before installing.",
      "Sony documents Windows 11 on Intel or AMD PCs and macOS 14, 15, and 26 on Apple silicon. ARM PCs and Intel Macs are unsupported.",
    ],
    source: "Sony",
  };
}

/** These URLs send shoppers directly to live external search results; no prices or offers are synthesized here. */
export function shoppingSearchLinks(observed: Observed): LiveSearchResult {
  const name = (observed.title || observed.item || "").trim().slice(0, 120);
  if (!name) throw new Error("This scan does not have a product name to search.");
  const software = productSoftwareInfo(observed);
  const query = software ? "Sony cameras for Imaging Edge Webcam" : name;
  return {
    query,
    searchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`,
    shoppingUrl: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`,
    software,
    message: software
      ? "Imaging Edge Webcam is free software from Sony. These live external searches are for related camera hardware; verify camera compatibility on Sony’s supported list."
      : "These links open live search results on external retailer sites.",
  };
}
