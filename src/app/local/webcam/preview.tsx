"use client";

import Link from "next/link";
import { useState } from "react";
import { ConnectionCard } from "@/components/connection";
import { draftFor } from "@/components/composer";
import { Shopping } from "@/components/shopping";
import type { LiveSearchResult } from "@/lib/commerce/live-search";
import type { ScanResult } from "@/lib/scan-types";

type PreviewMessage = { speaker: string; text: string; date: string | null };

export function WebcamPreview({ result, search, messages, peopleCount, mentionCount }: {
  result: ScanResult; search: LiveSearchResult; messages: PreviewMessage[]; peopleCount: number; mentionCount: number;
}) {
  const [draft, setDraft] = useState(() => draftFor(result));
  return <main className="app">
    <header className="appbar"><Link href="/local/webcam" className="brand">↗ callback<span>.</span></Link><nav><span className="chip">Local demo</span></nav></header>
    <section className="shop-section">
      <p className="eyebrow">Local scenario preview</p>
      <h1>Imaging Edge Webcam</h1>
      <p className="fine-print">{messages.length} synthetic messages from {peopleCount} people · {mentionCount} supported mention. No Supabase account is needed. The identified item and relation are supplied by the local fixture; camera recognition and model extraction are simulated.</p>
    </section>
    <ConnectionCard result={result} />
    <section className="composer-card">
      <label className="field-label" htmlFor="local-webcam-draft">Draft a message to Maya</label>
      <textarea id="local-webcam-draft" maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <p className="fine-print">Local draft only. It stays on this page and is never sent.</p>
    </section>
    <Shopping result={result} previewSearch={search} userId="local-preview" messages={[]} messagesReady refresh={async () => {}} />
    <details className="shop">
      <summary>Review the {messages.length} synthetic messages</summary>
      <section className="shop-section"><ol>{messages.map((message, index) => <li key={index}><strong>{message.speaker}</strong> · {message.date ? new Date(message.date).toLocaleDateString("en-US", { timeZone: "UTC" }) : "Date unknown"}<p>{message.text}</p></li>)}</ol></section>
    </details>
  </main>;
}
