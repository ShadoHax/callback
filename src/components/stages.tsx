import type { StageEvent } from "@/lib/scan-types";

const icons: Record<string, string> = {
  frame_received: "◉", context_loaded: "≡", entity_identified: "◎", searching: "⌕", mentions_found: "⌕",
  ruled_out: "✕", matched: "★", needs_clarification: "?", no_match: "∅",
};

// Each row is a real pipeline event from the server, with its real elapsed time. Nothing here is simulated.
export function Stages({ events, busy, collapsed, completedMs }: { events: StageEvent[]; busy: boolean; collapsed: boolean; completedMs?: number }) {
  if (!events.length && !busy) return null;
  const list = <ol className="stages" aria-live="polite">
    {events.map((event, index) => {
      const pending = busy && index === events.length - 1;
      return <li key={index} className={`stage stage-${event.type}`}>
        <span className={`stage-icon${pending ? " spinner" : ""}`} aria-hidden>{pending ? "" : icons[event.type] ?? "·"}</span>
        <span className="stage-text">{event.message}</span>
        {event.elapsedMs !== undefined && <time>{(event.elapsedMs / 1000).toFixed(1)}s</time>}
      </li>;
    })}
    {busy && !events.length && <li className="stage"><span className="stage-icon spinner" aria-hidden /><span className="stage-text">Uploading photo…</span></li>}
  </ol>;
  if (!collapsed) return list;
  // Once the answer is in, fold the trace into one line so the result card is on screen; one tap reopens it.
  // completedMs is the terminal event's time, sent after the photo and result were saved.
  return <details className="stages-summary"><summary>How we got here · {events.length} steps{completedMs !== undefined ? ` · done in ${(completedMs / 1000).toFixed(1)}s` : " · restored"}</summary>{list}</details>;
}
