import { readFile } from "node:fs/promises";
import { notFound } from "next/navigation";
import { TargetARPlayground } from "@/components/ar/target-ar";
export const dynamic = "force-dynamic";
export default async function PreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  let initialImageUrl: string | undefined;
  try { initialImageUrl = `data:image/jpeg;base64,${(await readFile('data/private/ar-target/coffee.jpg')).toString('base64')}`; } catch {}
  return <TargetARPlayground initialImageUrl={initialImageUrl} allowMotionTest demoCards />;
}
