import { basename, extname } from "node:path";

export const IMAGE = /\.(jpe?g|png|webp|heic|heif)$/i;
export const MAX_PHOTOS = 30;

export type PhotoCase = {
  file: string;
  status: "matched" | "no_match" | "needs_clarification";
  person?: string;
  relation?: string;
};

/** Validate every expectation before signing in or preparing the paid model-backed memory. */
export function parsePhotoCases(raw: unknown, imageFiles: string[]): PhotoCase[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray((raw as { cases?: unknown }).cases)) {
    throw new Error("Photo cases manifest must be an object with a cases array.");
  }
  const rows = (raw as { cases: unknown[] }).cases;
  if (!rows.length || rows.length > MAX_PHOTOS) throw new Error(`List 1–${MAX_PHOTOS} photo cases.`);
  const available = new Set(imageFiles);
  const seen = new Set<string>();
  const cases: PhotoCase[] = [];
  for (const [index, value] of rows.entries()) {
    const label = `Case ${index + 1}`;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some((key) => !["file", "status", "person", "relation"].includes(key))) throw new Error(`${label} has an unknown field.`);
    if (typeof item.file !== "string" || item.file !== basename(item.file) || /[\\/\0]/.test(item.file) || item.file === "." || item.file === ".." || !IMAGE.test(item.file) || !extname(item.file)) {
      throw new Error(`${label} needs an image filename inside the photo folder (no path).`);
    }
    if (seen.has(item.file)) throw new Error(`Duplicate photo case: ${item.file}.`);
    if (!available.has(item.file)) throw new Error(`${label} names a missing photo: ${item.file}.`);
    if (item.status !== "matched" && item.status !== "no_match" && item.status !== "needs_clarification") throw new Error(`${label} has an invalid status.`);
    const hasPerson = typeof item.person === "string" && item.person.trim().length > 0;
    const hasRelation = typeof item.relation === "string" && item.relation.trim().length > 0;
    if (item.status === "matched" && (!hasPerson || !hasRelation)) throw new Error(`${label} is matched and needs person and relation.`);
    if (item.status !== "matched" && (item.person !== undefined || item.relation !== undefined)) throw new Error(`${label} may specify person and relation only for matched status.`);
    if (hasPerson && item.person !== (item.person as string).trim()) throw new Error(`${label} has whitespace around person.`);
    if (hasRelation && item.relation !== (item.relation as string).trim()) throw new Error(`${label} has whitespace around relation.`);
    seen.add(item.file);
    cases.push({ file: item.file, status: item.status, ...(hasPerson ? { person: item.person as string } : {}), ...(hasRelation ? { relation: item.relation as string } : {}) });
  }
  const unlabeled = imageFiles.filter((file) => !seen.has(file));
  if (unlabeled.length) throw new Error(`Add every photo to the cases manifest or move it out of the folder. Unlabeled: ${unlabeled.join(", ")}`);
  return cases;
}

export function matchesPhotoExpectation(expected: PhotoCase, actual: { status: string; person?: string; relation?: string } | null, http: number) {
  return http === 200 && actual?.status === expected.status &&
    (expected.status !== "matched" || (actual.person === expected.person && actual.relation === expected.relation));
}

export function photoCaseCounts(cases: PhotoCase[], rows: { file: string; pass: boolean }[]) {
  return (["matched", "no_match", "needs_clarification"] as const).map((status) => {
    const inGroup = cases.filter((item) => item.status === status);
    return { status, passed: inGroup.filter((item) => rows.find((row) => row.file === item.file)?.pass).length, total: inGroup.length };
  });
}
