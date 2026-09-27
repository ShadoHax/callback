"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Device = { id: string; kind: "quest" | "glasses" | "pi"; name: string; expires_at: string; revoked_at: string | null };

export default function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [kind, setKind] = useState<Device["kind"]>("quest");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const response = await fetch("/api/devices", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) setDevices(data.devices ?? []);
      else setMessage(data.error ?? "Could not load devices.");
    } catch { setMessage("Could not load devices."); }
  }
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, []);

  async function pair() {
    if (!name.trim()) return;
    setBusy(true); setMessage(""); setToken("");
    try {
      const response = await fetch("/api/devices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, name }) });
      const data = await response.json();
      if (!response.ok) setMessage(data.error ?? "Could not create a device token.");
      else { setToken(data.token); setName(""); setMessage(data.notice); await load(); }
    } catch { setMessage("Could not create a device token."); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/devices/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) setMessage(data.error ?? "Could not revoke device.");
      else { setMessage("Device access revoked."); await load(); }
    } catch { setMessage("Could not revoke device."); }
    finally { setBusy(false); }
  }

  return <main className="shell"><header className="topbar"><Link href="/" className="brand">↗ callback<span>.</span></Link><nav><Link href="/">Scan</Link><Link href="/inbox">Inbox</Link><Link href="/login">Account</Link></nav></header>
    <section className="hero"><div className="eyebrow">HARDWARE BRIDGE</div><h1>Bring a device<span className="accent">.</span></h1><p>Pair a Quest, AI glasses companion, or Raspberry Pi. Glasses can discover connections from camera frames; a Pi can celebrate a match with light and sound.</p></section>
    <div className="device-grid"><section className="panel device-panel"><div className="step">01 / PAIR</div><h2>Create device access</h2><p className="muted">Tokens last 24 hours. Quest and glasses tokens can scan images. Glasses voice messaging is experimental and disabled by default. When enabled, use the companion app to review and confirm a draft before sending; it can also read replies aloud. A Pi token receives short connection events. Keep tokens private.</p><label>Device type<select value={kind} onChange={(e) => setKind(e.target.value as Device["kind"])}><option value="quest">Meta Quest</option><option value="glasses">AI glasses companion</option><option value="pi">Raspberry Pi beacon</option></select></label><label>Device name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={kind === "pi" ? "Desk beacon" : "Demo Quest 3"} /></label><button className="primary" disabled={busy || !name.trim()} onClick={pair}>Create token <span>↗</span></button>{token && <div className="token-box"><strong>Copy this token now</strong><p className="muted">It is shown once. Enter it on your device and keep it private.</p><textarea readOnly value={token} aria-label="One-time device token" /><button className="text-button" onClick={() => navigator.clipboard.writeText(token)}>Copy token</button></div>}{message && <p role="status" className="muted">{message}</p>}</section>
    <section className="panel device-panel"><div className="step">02 / MANAGE</div><h2>Paired devices</h2>{devices.length ? devices.map((device) => <article className="device-row" key={device.id}><div><strong>{device.name}</strong><p className="muted">{device.kind === "quest" ? "Meta Quest" : device.kind === "pi" ? "Raspberry Pi beacon" : "AI glasses"} · {device.revoked_at ? "Revoked" : new Date(device.expires_at) <= new Date() ? "Expired" : `Expires ${new Date(device.expires_at).toLocaleString()}`}</p></div>{!device.revoked_at && new Date(device.expires_at) > new Date() && <button className="text-button" disabled={busy} onClick={() => revoke(device.id)}>Revoke</button>}</article>) : <p className="muted">No paired devices yet.</p>}</section></div>
    <footer>Capture stays intentional. A device scan finds a connection; sending still needs your confirmation in Callback.</footer>
  </main>;
}
