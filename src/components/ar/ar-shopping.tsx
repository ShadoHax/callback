"use client";

import { useEffect, useState } from "react";
import type { Purpose } from "@/lib/commerce/options";
import type { Discovery } from "@/lib/commerce/discovery";

export type ArShoppingState = {
  status: "loading" | "ready" | "empty" | "error";
  title?: string;
  merchant?: string;
  price?: string;
  url?: string;
  detail?: string;
};

const empty: ArShoppingState = { status: "empty", detail: "Save this scan to look for current listings." };
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function safeHttps(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function displayDiscovery(data: Discovery): ArShoppingState {
  const top = Array.isArray(data.offers) ? data.offers[0] : undefined;
  if (top) {
    const url = safeHttps(top.merchantUrl);
    if (!url) return { status: "error", detail: "The top listing has no safe purchase link." };
    const caveats = Array.isArray(top.caveats) ? top.caveats.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    return {
      status: "ready", title: top.title, merchant: top.merchant,
      price: Number.isFinite(top.price?.amountCents) && top.price.amountCents > 0 ? currency.format(top.price.amountCents / 100) : undefined,
      url, detail: ["Top match in current listings. Check the exact item and total on the linked site.", ...caveats].join(" "),
    };
  }
  return {
    status: "empty", title: "Search current listings", url: safeHttps(data.fallbackSearchUrl),
    detail: data.status === "provider_unavailable"
      ? "Priced listings are unavailable right now. Open the live search results instead."
      : "No verified priced listing matched this scan. Open the live search results instead.",
  };
}

/** Loads ranked listings for one persisted scan and purpose, independent of overlay box updates. */
export function useArShopping(scanId?: string, purpose?: Purpose): ArShoppingState {
  const kind = purpose?.kind ?? "self";
  const personId = purpose && purpose.kind !== "self" ? purpose.personId : "";
  const key = `${scanId ?? ""}|${kind}|${personId}`;
  const [snapshot, setSnapshot] = useState<{ key: string; state: ArShoppingState }>({ key: "", state: empty });

  useEffect(() => {
    if (!scanId) return;
    const controller = new AbortController();
    let current = true;
    const selectedPurpose: Purpose = kind === "self" ? { kind: "self" } : kind === "gift"
      ? { kind: "gift", personId } : { kind: "together", personId };
    void fetch("/api/v1/shop/discover", {
      method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ scanId, purpose: selectedPurpose }),
    }).then(async (response) => {
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string" ? payload.error : "Could not find current listings.");
      return payload as Discovery;
    }).then((data) => {
      if (current && !controller.signal.aborted) setSnapshot({ key, state: displayDiscovery(data) });
    }).catch((cause: unknown) => {
      if (current && !controller.signal.aborted) setSnapshot({ key, state: { status: "error", detail: cause instanceof Error ? cause.message : "Could not find current listings." } });
    });
    return () => { current = false; controller.abort(); };
  }, [scanId, kind, personId, key]);

  return !scanId ? empty : snapshot.key === key ? snapshot.state : { status: "loading", detail: "Checking current listings…" };
}
