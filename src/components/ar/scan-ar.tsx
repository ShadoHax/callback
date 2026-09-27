"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TargetAR } from "./target-ar";
import { useArShopping } from "./ar-shopping";
import { targetClass } from "@/lib/target-detector";
import type { Purpose } from "@/lib/commerce/options";
import type { ScanResult } from "@/lib/scan-types";

type SavedScan = { result: ScanResult; imageUrl: string | null };

function supportedTarget(result: ScanResult) {
  for (const candidate of [result.observedEntity, result.category]) {
    const text = candidate?.trim();
    if (text && targetClass(text)) return text;
  }
  return null;
}

function shoppingPurpose(result: ScanResult, selfRequested: boolean): Purpose | undefined {
  if (result.entityKind === "place" || result.status === "needs_clarification") return undefined;
  if (selfRequested) return { kind: "self" };
  if (result.status !== "matched") return undefined;
  const relation = result.relation || result.people?.[0]?.relation;
  const personId = result.person || result.people?.[0]?.personId;
  if (!personId) return undefined;
  if (relation === "planned_together") return { kind: "together", personId };
  if (relation === "wanted" || relation === "asked_to_find" || relation === "prefers") return { kind: "gift", personId };
  return undefined;
}

/** Opens an authenticated saved scan; the model's observation supplies the detector target. */
export function ScanAR({ scanId, selfShopping = false }: { scanId: string; selfShopping?: boolean }) {
  const router = useRouter();
  const [scan, setScan] = useState<SavedScan | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void fetch(`/api/scans/${encodeURIComponent(scanId)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { error?: string; scan?: SavedScan } | null;
        if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "Could not load this scan.");
        const saved = payload?.scan;
        if (!saved?.result || saved.result.scanId !== scanId || saved.result.persisted === false) {
          throw new Error("This saved scan could not be opened in AR.");
        }
        return saved;
      })
      .then((saved) => { if (current && !controller.signal.aborted) setScan(saved); })
      .catch((cause: unknown) => {
        if (current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load this scan.");
      })
      .finally(() => { if (current && !controller.signal.aborted) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [scanId]);

  const target = scan ? supportedTarget(scan.result) : null;
  const purpose = scan && target ? shoppingPurpose(scan.result, selfShopping) : undefined;
  const shopping = useArShopping(purpose ? scanId : undefined, purpose);
  if (loading) return <main className="app"><p role="status">Opening your saved scan…</p></main>;
  if (error) return <main className="app"><p role="alert">{error}</p><Link href="/">Back to scanner</Link></main>;
  if (!scan) return <main className="app"><p role="alert">The saved scan is unavailable.</p><Link href="/">Back to scanner</Link></main>;
  if (scan.result.entityKind === "place") return <main className="app"><p role="status">AR object tracking is for physical items. Open this place in the scan instead.</p><Link href={`/?scan=${encodeURIComponent(scanId)}`}>Open scan</Link></main>;
  if (!target) return <main className="app"><p role="status">This scan names an item the on-device detector cannot track yet.</p><Link href={`/?scan=${encodeURIComponent(scanId)}`}>Open scan</Link></main>;

  const personName = scan.result.personName || scan.result.people?.[0]?.personName;
  const reason = scan.result.reason;
  const connection = scan.result.status === "matched" && personName && reason
    ? { personName, reason, onOpen: () => router.push(`/?scan=${encodeURIComponent(scanId)}`) }
    : undefined;
  return <TargetAR target={target} initialImageUrl={scan.imageUrl ?? undefined} connection={connection}
    shopping={purpose ? shopping : undefined} />;
}
