// Shared helpers for scripts that talk to a running app and to Supabase as real users.
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const need = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Set ${name} in .env.local.`); return value; };
export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
export const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

export function flags(argv: string[]) {
  const read = (name: string) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : undefined; };
  return { read, has: (name: string) => argv.includes(`--${name}`) };
}

/** Signs in through @supabase/ssr, so the cookies are exactly what the app's server client reads. */
export async function session(app: string, email: string, password: string) {
  const url = need("NEXT_PUBLIC_SUPABASE_URL"), key = need("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const jar = new Map<string, string>();
  const client = createServerClient(url, key, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (items) => items.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))) } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user || !data.session) throw new Error(`Sign-in failed for ${email}: ${error?.message ?? "no session"}`);
  await sleep(50);
  const direct = createClient(url, key, { auth: { persistSession: false } });
  await direct.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  const call = (path: string, init: RequestInit = {}) => fetch(`${app}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
  return { id: data.user.id, email, call, direct };
}
export type Session = Awaited<ReturnType<typeof session>>;

export async function photo(path: string) {
  const type = MIME[extname(path).toLowerCase()];
  if (!type) throw new Error(`${path}: use .jpg, .png, or .webp`);
  return new File([await readFile(path)], path, { type });
}

export async function reachable(app: string) {
  try { const response = await fetch(`${app}/api/shop/config`, { signal: AbortSignal.timeout(8000) }); return response.ok; } catch { return false; }
}

export const messagesOf = async (user: Session) => {
  const response = await user.call("/api/messages");
  if (!response.ok) throw new Error(`GET /api/messages → ${response.status}`);
  return ((await response.json()).messages ?? []) as { id: string; reply_to: string | null; scan_id?: string | null; about_person_id?: string | null; imageUrl?: string | null; quoted_text?: string | null; purpose?: string | null }[];
};
export const post = async (user: Session, body: object) => { const response = await user.call("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json().catch(() => ({})) }; };

export async function waitFor<T>(label: string, probe: () => Promise<T | null | undefined>, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { const value = await probe(); if (value) return { value, ms: Date.now() - started }; await sleep(250); }
  throw new Error(`${label} did not arrive within ${timeoutMs / 1000}s`);
}

export function recorder() {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail = "") => { checks.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); return ok; };
  return { checks, check };
}

export const service = () => createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

/** Total complete runs and the longest run of consecutive complete runs; a run counts only if every assertion passed. */
export function runSummary(runs: { ok: boolean }[]) {
  let longest = 0, current = 0;
  for (const run of runs) { current = run.ok ? current + 1 : 0; longest = Math.max(longest, current); }
  return { complete: runs.filter((run) => run.ok).length, longest, trailing: current };
}
