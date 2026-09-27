import { ARDemo } from "@/components/banana-demo";
import { ScanAR } from "@/components/ar/scan-ar";
import Link from "next/link";
export const metadata = { title: "Callback — target AR" };
export default async function GlassesPage({ searchParams }: { searchParams: Promise<{ scan?: string | string[]; shop?: string | string[] }> }) {
  const query = await searchParams;
  if (query.scan === undefined) return <ARDemo />;
  if (typeof query.scan !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.scan)) {
    return <main className="app"><p role="alert">Invalid saved scan link.</p><Link href="/">Back to scanner</Link></main>;
  }
  return <ScanAR key={query.scan} scanId={query.scan} selfShopping={query.shop === "self"} />;
}
