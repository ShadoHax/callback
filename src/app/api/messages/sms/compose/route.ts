import { z } from "zod";
import { configured, serverSupabase } from "@/lib/supabase";
import { authorizePersonalSms } from "@/lib/sms-authorization";

const Input = z.object({ scanId: z.string().uuid(), recipientId: z.string().uuid() });

// Returns a privately configured phone number only to the signed-in owner of
// the matching scan. The browser uses it to open the owner's native SMS
// composer. Callback never sends the text itself.
export async function POST(request: Request) {
  if (!configured()) return Response.json({ error: "Messaging is not configured." }, { status: 503 });
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid SMS recipient." }, { status: 400 });
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to text this person." }, { status: 401 });
  const { scanId, recipientId } = parsed.data;
  const authorization = await authorizePersonalSms(supabase, user.id, scanId, recipientId);
  if ("error" in authorization) return Response.json({ error: authorization.error }, { status: authorization.status });
  return Response.json({ phone: authorization.phone }, { headers: { "cache-control": "private, no-store" } });
}
