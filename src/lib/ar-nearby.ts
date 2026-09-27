import { ModelError, modelConfig } from "./model";

const FALLBACK_LOCATION = "Klaus Advanced Computing Building, Georgia Tech, Atlanta, GA";
const REQUEST_TIMEOUT_MS = 40_000;

type Coordinates = { latitude: number; longitude: number };
export type NearbyPlace = { name: string; address?: string; url: string; summary?: string };
export type NearbyPlaces = {
  query: string; url: string; locationLabel: string; usedFallback: boolean;
  places: NearbyPlace[]; summary?: string; model: string; timingMs: number; searched: true;
};

type Citation = { type?: unknown; url?: unknown; title?: unknown; start_index?: unknown; end_index?: unknown };
type TextBlock = { type?: unknown; text?: unknown; annotations?: unknown };
type SearchResult = { title?: unknown; url?: unknown; snippet?: unknown };
type OutputItem = { type?: unknown; status?: unknown; content?: unknown; results?: unknown };

function checkedCoordinates(value?: Coordinates): Coordinates | null {
  if (!value) return null;
  const { latitude, longitude } = value;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude: Math.round(latitude * 1000) / 1000, longitude: Math.round(longitude * 1000) / 1000 };
}

function safeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = new URL(raw);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch { return null; }
}

function normalized(text: string) {
  return text.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function parsePlaces(block: TextBlock, searchResults: SearchResult[], usedFallback: boolean): NearbyPlace[] {
  if (typeof block.text !== "string") return [];
  const citations = (Array.isArray(block.annotations) ? block.annotations : []).filter((candidate): candidate is Citation =>
    !!candidate && typeof candidate === "object" && (candidate as Citation).type === "url_citation" &&
    Number.isInteger((candidate as Citation).start_index) && Number.isInteger((candidate as Citation).end_index) &&
    !!safeSourceUrl((candidate as Citation).url));
  const found: NearbyPlace[] = [];
  const names = new Set<string>();
  let lineStart = 0;
  for (const line of block.text.split("\n")) {
    const lineEnd = lineStart + line.length;
    // A citation must support the same line as the displayed venue. Do not turn
    // uncited text, even from a response that performed a search, into a place.
    const citation = citations.find((entry) => (entry.start_index as number) < lineEnd &&
      (entry.end_index as number) > lineStart);
    const match = line.match(/^\s*(?:[-*]|\d+[.)])\s*([^|\n]{2,100})\s*\|\s*([^|\n]{4,180})(?:\s*\|\s*([^|\n]{2,240}))?\s*$/);
    if (match) {
      const name = match[1].trim();
      const address = match[2].trim();
      const key = name.toLocaleLowerCase();
      // Meta sometimes completes a search but emits no url_citation annotations.
      // In that case, accept only exact venue-name matches in the search tool's
      // own returned source titles. The model alone is never the evidence.
      const source = searchResults.find((result) => {
        const title = typeof result.title === "string" ? normalized(result.title) : "";
        const snippet = typeof result.snippet === "string" ? normalized(result.snippet) : "";
        const url = safeSourceUrl(result.url);
        const local = !usedFallback || /\batlanta\b|\bgeorgia tech\b|\bgatech\b/.test(`${title} ${snippet} ${url ?? ""}`);
        return normalized(name).length >= 6 && title.includes(normalized(name)) && !!url && local;
      });
      const citationNamesVenue = citation && typeof citation.title === "string" &&
        normalized(name).length >= 6 && normalized(citation.title).includes(normalized(name));
      const citationLocal = !usedFallback || /\batlanta\b|\bgeorgia tech\b|\bgatech\b/.test(
        `${normalized(typeof citation?.title === "string" ? citation.title : "")} ${citation?.url ?? ""}`);
      const citedUrl = citationNamesVenue && citationLocal ? safeSourceUrl(citation.url) : null;
      const url = citedUrl ?? safeSourceUrl(source?.url);
      if (url && !names.has(key)) {
        const evidence = `${typeof source?.title === "string" ? source.title : ""} ${typeof source?.snippet === "string" ? source.snippet : ""}`;
        // Citation URLs can point to a different venue even when attached to a
        // venue line. Show details only when the source metadata itself backs them.
        found.push({ name, ...(normalized(evidence).includes(normalized(address)) ? { address } : {}), url });
        names.add(key);
      }
    }
    lineStart = lineEnd + 1;
  }
  return found.slice(0, 2);
}

/** Live venue lookup. Caller supplies only a grounded category, never private message text. */
export async function searchNearbyPlaces(input: {
  query: string; location?: Coordinates; signal?: AbortSignal;
}): Promise<NearbyPlaces> {
  const query = input.query.replace(/\s+/g, " ").trim();
  if (!query || query.length > 120 || /https?:\/\/|[\r\n\x00-\x1f]/i.test(input.query))
    throw new Error("The nearby search query is invalid.");
  const coords = checkedCoordinates(input.location);
  const usedFallback = !coords;
  const locationLabel = coords ? "Your current location" : FALLBACK_LOCATION;
  const locationSearch = coords ? `${coords.latitude}, ${coords.longitude}` : FALLBACK_LOCATION;
  const maps = new URL("https://www.google.com/maps/search/");
  maps.searchParams.set("api", "1");
  maps.searchParams.set("query", `${query} near ${locationSearch}`);

  const config = modelConfig();
  if (config.provider !== "meta") throw new ModelError("Live nearby search requires the Meta model provider.");
  const model = process.env.AR_NEARBY_MODEL?.trim() || "muse-spark-1.1";
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(model)) throw new ModelError("AR_NEARBY_MODEL is invalid.");
  const started = Date.now();
  const signal = AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(input.signal ? [input.signal] : [])]);
  const body = {
    model,
    input: `Find up to two real ${query} within walking distance of ${locationSearch}. Search the live web. Use only public venue information.`,
    instructions: "Search the web for current, real venues close to the specified location. Answer with at most two numbered lines, each exactly: NAME | STREET ADDRESS | SHORT FACTUAL DESCRIPTION. Put a URL citation on each venue line that verifies the named place and location. Include no uncited venue. If none can be verified, say so without listing places. No introduction, progress updates, or closing text. Do not estimate a distance.",
    tools: [{ type: "web_search", search_context_size: "low" }],
    include: ["web_search_call.results"],
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: 3000,
  };
  let response: Response;
  try {
    response = await fetch(`${config.base}/responses`, { method: "POST", signal,
      headers: { authorization: `Bearer ${config.key}`, "content-type": "application/json" },
      body: JSON.stringify(body) });
  } catch (cause) {
    if (input.signal?.aborted) throw cause;
    throw new ModelError(signal.aborted ? "Nearby search timed out." : "Nearby search is unavailable.", signal.aborted ? 408 : undefined);
  }
  if (!response.ok) throw new ModelError(`Nearby search failed (${response.status}).`, response.status);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new ModelError("Nearby search returned malformed output.", 200); }
  const data = payload && typeof payload === "object" ? payload as { status?: unknown; output?: unknown } : {};
  if (data.status !== "completed" || !Array.isArray(data.output))
    throw new ModelError("Nearby search did not complete.", 200);
  const output = data.output as OutputItem[];
  const searches = output.filter((item) => item?.type === "web_search_call" && item.status === "completed");
  if (!searches.length)
    throw new ModelError("Nearby search did not search the web.", 200);
  const searchResults = searches.flatMap((item) => Array.isArray(item.results) ? item.results as SearchResult[] : []);
  const final = [...output].reverse().find((item) => item?.type === "message" && item.status === "completed");
  const blocks = Array.isArray(final?.content) ? final.content as TextBlock[] : [];
  const places = blocks.filter((block) => block?.type === "output_text").flatMap((block) => parsePlaces(block, searchResults, usedFallback)).slice(0, 2);
  if (!places.length) throw new ModelError("Nearby search found no cited places.", 200);
  return { query, url: maps.toString(), locationLabel, usedFallback, places,
    model, timingMs: Date.now() - started, searched: true };
}
