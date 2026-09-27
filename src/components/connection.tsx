"use client";

import { useEffect, useRef, useState } from "react";
import { displayName, relationLabel, type Relation } from "@/lib/decision";
import { formatDate, type Evidence, type ScanResult } from "@/lib/scan-types";

const speaker = (id: string) => (id === "owner" ? "You" : displayName(id));
const roleLabel: Record<string, string> = { newer: "Newer message", earlier: "Earlier message", caveat: "Related message" };

export function ConnectionCard({ result }: { result: ScanResult }) {
  const [open, setOpen] = useState(false);
  const [caveatIndex, setCaveatIndex] = useState(-1);
  const card = useRef<HTMLElement>(null);
  useEffect(() => { card.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, []);
  const group = result.people ?? [];
  const samePlacePeople = group.filter((person) => person.proximity?.status === "same_place");
  const evidence = group.length > 1 ? group.flatMap((person) => person.evidence) : result.evidence ?? [];
  const latest = evidence.map((item) => item.date).filter((date) => !Number.isNaN(Date.parse(date))).sort().at(-1);
  const synthetic = evidence.some((item) => item.synthetic);

  if (result.status === "no_match") return <article ref={card} className="card card-quiet">
    <h2>I couldn&apos;t find a supported connection in the context you&apos;ve shared.</h2>
    <p>That doesn&apos;t mean nobody connects to it. We just won&apos;t make one up.</p>
    {result.observedEntity && <p className="seen">Seen: {result.observedEntity}</p>}
  </article>;

  if (result.status === "needs_clarification") return <article ref={card} className="card card-quiet">
    <h2>Get a little closer.</h2>
    <p>{result.clarification || "The photo isn't specific enough to confirm a connection."}</p>
    {result.observedEntity && <p className="seen">Seen: {result.observedEntity}</p>}
  </article>;

  const name = group.length > 1 ? group.map((person) => person.personName).join(", ") : result.personName || displayName(result.person ?? "");
  const nextAction = result.relation === "planned_together" ? `Revisit your plan with ${name}`
    : result.relation === "asked_to_find" ? `Tell ${name} what you found`
    : `Write to ${name}`;
  return <article ref={card} className="card card-match">
    <p className="eyebrow">{result.entityKind === "place" ? "Being here made me think of" : "Saw this and thought of"}</p>
    <h2 className="person">{name}</h2>
    <p className="reason">{group.length > 1 ? `This ${result.entityKind === "place" ? "place" : "moment"} connects all of you through the same conversation.` : result.reason}</p>
    {result.relation === "prefers" && result.preferenceMatch !== "observed" && <p className="caveat"><span>Related taste, not a confirmed product match.</span> The photo reminded you of this preference; it doesn&apos;t confirm the preferred variety is shown.</p>}
    {result.location?.verified && <p className="why-now">Device-reported location · {Math.round(result.location.accuracy)} m accuracy</p>}
    {group.length <= 1 && result.proximity?.status === "same_place" && <p className="caveat"><span>{name} may be here now.</span> This callback could be a chance to say hi in person.</p>}
    {group.length > 1 && samePlacePeople.length > 0 && <p className="caveat"><span>{samePlacePeople.map((person) => person.personName).join(" and ")} may be here now.</span> This callback could become an in-person hello.</p>}
    {result.proximity?.status === "nearby" && <p className="why-now">{name} opted in and may be nearby.</p>}
    {evidence[0] && <button className="source-preview" onClick={() => setOpen(true)}>
      <span className="source-quote">“{evidence.find((item) => item.speakerId === result.person)?.text ?? evidence[0].text}”</span>
      <span className="source-meta">{speaker((evidence.find((item) => item.speakerId === result.person) ?? evidence[0]).speakerId)} · {formatDate((evidence.find((item) => item.speakerId === result.person) ?? evidence[0]).date)}{synthetic ? " · synthetic demo" : ""}</span>
    </button>}
    <p className="meta">
      {result.relation && <span>{name} {relationLabel(result.relation as Relation)}</span>}
      <span>{formatDate(latest)}</span>
      {synthetic && <span className="chip">synthetic demo context</span>}
    </p>
    {result.whyNow && <p className="why-now">{result.relation === "prefers" && result.preferenceMatch !== "observed" ? "A reason to check in, or look for a gift that actually matches their taste." : result.whyNow}</p>}
    {(result.caveats ?? []).map((caveat, index) => <p key={index} className="caveat"><span>Worth checking:</span> {caveat.message} {caveat.evidence.length > 0 && <button className="text-button" onClick={() => setCaveatIndex(index)}>Source</button>}</p>)}
    {result.recipientId && <button className="secondary" onClick={() => document.getElementById("connection-composer")?.scrollIntoView({ behavior: "smooth", block: "center" })}>{nextAction} <span aria-hidden>↘</span></button>}
    {evidence.length > 0 && <button className="evidence-button" onClick={() => setOpen(true)}>See the original {evidence.length === 1 ? "message" : `${evidence.length} messages`} <span aria-hidden>↗</span></button>}
    {result.observedEntity && <p className="seen">Seen: {result.observedEntity}</p>}
    {open && <EvidenceSheet evidence={evidence} onClose={() => setOpen(false)} />}
    {caveatIndex >= 0 && result.caveats?.[caveatIndex] && <EvidenceSheet evidence={result.caveats[caveatIndex].evidence} title="The other message" onClose={() => setCaveatIndex(-1)} />}
  </article>;
}

/** The classifier's view: what the photo was recognized as, and every plausible friend's confidence. */
export function Confidence({ result }: { result: ScanResult }) {
  const ranking = (result.ranking ?? []).filter((item) => item.eligible && item.score > 0);
  const topics = result.topicMatches ?? [];
  if (!ranking.length && !topics.length) return null;
  return <section className="confidence" aria-label="Match scores">
    {topics.length > 0 && <p className="fine-print">Recognized as {topics.map((match) => match.topic).join(", ")}</p>}
    {ranking.length > 0 && <p className="fine-print">Match scores · stronger matches rank higher</p>}
    {ranking.map((item) => <div key={item.personId} className={`confidence-row${item.personId === result.person ? " confidence-winner" : ""}`}>
      <span className="confidence-name">{item.personName}</span>
      <span className="confidence-bar" aria-hidden><span style={{ width: `${Math.round(item.score * 100)}%` }} /></span>
      <span className="confidence-value">{Math.round(item.score * 100)}/100</span>
      <span className="confidence-why">{item.topic ?? item.mention} · {relationLabel(item.relation as Relation)}</span>
    </div>)}
    {result.verification?.checked && <p className="fine-print">{result.verification.sensible ? "Suggestion checked" : "Suggestion held back"}{result.verification.why ? `: ${result.verification.why}` : "."}</p>}
    {result.verification?.error && <p className="fine-print">The extra suggestion check was unavailable. Review the original words before reaching out.</p>}
    {result.status !== "matched" && ranking.length > 0 && !result.verification?.checked && <p className="fine-print">No sufficiently supported suggestion for this view.</p>}
  </section>;
}

export function EvidenceSheet({ evidence, onClose, title }: { evidence: Evidence[]; onClose: () => void; title?: string }) {
  return <div className="sheet-backdrop" onClick={onClose}>
    <section className="sheet" role="dialog" aria-modal="true" aria-label="Original messages" onClick={(event) => event.stopPropagation()}>
      <header><h3>{title ?? `The original ${evidence.length === 1 ? "message" : "messages"}`}</h3><button className="text-button" onClick={onClose}>Close</button></header>
      {evidence.map((item) => <figure key={`${item.role}-${item.id}`} className="evidence">
        {item.role && roleLabel[item.role] && <p className="evidence-role">{roleLabel[item.role]}</p>}
        <blockquote>{item.text}</blockquote>
        <figcaption>{speaker(item.speakerId)} · {formatDate(item.date)}{item.synthetic && <span className="chip">synthetic demo context</span>}</figcaption>
      </figure>)}
      <p className="fine-print">Shown word for word from the messages you imported. Callback never writes quotes.</p>
    </section>
  </div>;
}

export function RuledOutList({ result }: { result: ScanResult }) {
  const [openId, setOpenId] = useState("");
  const items = result.ruledOut ?? [];
  if (!items.length) return null;
  const selected = items.find((item) => item.personId === openId);
  return <details className="ruled-out" open={result.status !== "matched"}>
    <summary>{result.status === "matched" ? `Why not the other ${items.length === 1 ? "person" : `${items.length} people`}?` : `Checked ${items.length} ${items.length === 1 ? "person" : "people"}`}</summary>
    <ul>{items.map((item) => <li key={item.personId}>
      <span>{item.message}</span>
      {item.evidence.length > 0 && <button className="text-button" onClick={() => setOpenId(item.personId)}>Source</button>}
    </li>)}</ul>
    {selected && <EvidenceSheet evidence={selected.evidence} title={`Why not ${selected.personName}`} onClose={() => setOpenId("")} />}
  </details>;
}
