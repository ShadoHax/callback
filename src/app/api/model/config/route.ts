import { modelDisplayConfig } from "@/lib/model";

export async function GET() {
  try { return Response.json(modelDisplayConfig(), { headers: { "cache-control": "no-store" } }); }
  catch { return Response.json({ error: "Model settings are invalid." }, { status: 503 }); }
}
