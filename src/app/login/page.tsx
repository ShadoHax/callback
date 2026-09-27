"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/browser-supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [currentEmail, setCurrentEmail] = useState("");
  useEffect(() => { browserSupabase()?.auth.getUser().then(({ data }) => setCurrentEmail(data.user?.email ?? "")); }, []);
  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const client = browserSupabase();
    if (!client) { setMessage("Supabase is not configured. See .env.example."); setBusy(false); return; }
    const { error } = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMessage(error.message); else router.push("/");
  }
  async function signOut() {
    const client = browserSupabase();
    if (!client) return;
    setBusy(true);
    const { error } = await client.auth.signOut();
    setBusy(false);
    if (error) setMessage(error.message); else { localStorage.removeItem("callback-last-scan"); setCurrentEmail(""); setMessage("Signed out."); router.refresh(); }
  }
  return <main className="shell"><header className="topbar"><Link href="/" className="brand">↗ callback<span>.</span></Link><nav><Link href="/inbox">Inbox</Link><Link href="/devices">Devices</Link></nav></header><section className="auth"><div className="eyebrow">YOUR ACCOUNT</div><h1>{currentEmail ? "You’re signed in." : "Welcome back."}</h1><p className="muted">{currentEmail ? `Signed in as ${currentEmail}.` : "Sign in with a pre-provisioned demo account."}</p>{currentEmail ? <button className="primary" disabled={busy} onClick={signOut}>Sign out</button> : <form onSubmit={signIn}><label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form>}{message && <p className="error" role="status">{message}</p>}</section></main>;
}
