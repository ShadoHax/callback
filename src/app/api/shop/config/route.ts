import { json, shopConfig } from "@/lib/commerce/route-helpers";

export async function GET() {
  return json(shopConfig());
}
