// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { TargetAR } from "../src/components/ar/target-ar";

const state = vi.hoisted(() => ({ props: null as ComponentProps<typeof TargetAR> | null }));
vi.mock("../src/components/ar/target-ar", () => ({ TargetAR: (props: ComponentProps<typeof TargetAR>) => {
  state.props = props;
  return <div>{props.children as ReactNode}{props.compactOverlay && <button onClick={props.compactOverlay.onOpen}>Open reminder</button>}</div>;
} }));
import { ARDemo } from "../src/components/banana-demo";

const scan = { detected: true, matched: true, connectionToken: "signed-owner-connection",
  identification: { item: "tomatoes", category: "produce", confidence: .98, boundingBox: { x: .1, y: .1, width: .8, height: .8 } },
  memory: { personName: "Maya", shortLabel: "Pasta this weekend", quote: "Let's make pasta together this weekend.", sourceAt: "2026-09-12", synthetic: true,
    connection: "You and Maya planned to make pasta.", suggestedActions: [
      { kind: "recipe", label: "Make a recipe" }, { kind: "shop", label: "Shop supplies" }, { kind: "nearby", label: "Find nearby" },
    ] } };
const recipe = { supported: true, action: "recipe", plan: { title: "Pasta together", summary: "A simple shared dinner.",
  steps: ["Boil water and salt it.", "Cook pasta until tender."], invitation: "" } };
const shop = { supported: true, action: "shop", plan: { title: "Pasta supplies", summary: "Ingredients for dinner.",
  steps: ["Gather the ingredients.", "Cook together."], invitation: "Want to cook together?" },
  shopping: { allIngredientsHaveOffers: true, ingredients: [{ query: "Pasta", quantity: 1, reason: "One box for dinner.", status: "ok", provider: "searchapi",
    fallbackSearchUrl: "https://www.google.com/search?tbm=shop&q=Pasta", offers: [{ id: "pasta-offer", title: "Durum wheat pasta", merchant: "Grocer",
      merchantUrl: "https://example.com/pasta", price: { amountCents: 1599, currency: "USD", observedAt: "2026-09-26T00:00:00Z" } }] }] } };
const nearby = { supported: true, action: "nearby", nearby: { query: "grocery stores near me", url: "https://www.google.com/maps/search/?api=1&query=grocery+stores+near+me",
  locationLabel: "Atlanta, GA", usedFallback: false, summary: "Grocery options for dinner together.",
  places: [{ name: "Local Market", address: "123 Peach Street", url: "https://example.com/market", summary: "Fresh pasta ingredients." }] } };
function deferred() { let resolve!: (r: Response) => void; return { promise: new Promise<Response>(r => { resolve = r; }), resolve: (r: Response) => resolve(r) }; }
function start(fetcher: typeof fetch) { vi.stubGlobal("fetch", fetcher); render(<ARDemo />); }
async function cameraFrame() { await act(async () => { await state.props!.onDetectedFrame!(new Blob(["video frame"]), 0, "scene"); }); }
async function openScan() { await cameraFrame(); fireEvent.click(await screen.findByRole("button", { name: "Open reminder" })); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); state.props = null; });

it("keeps the AR chip brief and fetches recipe and live ingredient offers only after explicit taps", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (url === "/api/context/prepare") return Response.json({ ready: true });
    if (url === "/api/demo/ar/scan") return Response.json(scan);
    if (url === "/api/ar/activity") return Response.json(JSON.parse(options!.body as string).action === "recipe" ? recipe : shop);
    throw new Error(`Unexpected request: ${url}`);
  });
  start(fetcher);
  await screen.findByText("Look around. Remember someone.");
  expect(state.props!.generalScan).toBe(true);
  await cameraFrame();
  await screen.findByRole("button", { name: "Open reminder" });
  expect(state.props!.compactOverlay?.personName).toBe("Maya");
  expect(state.props!.compactOverlay?.memory).toBe("Pasta this weekend");
  expect(state.props!.compactOverlay?.testLabel).toBeUndefined();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/context/prepare", "/api/demo/ar/scan"]);

  fireEvent.click(screen.getByRole("button", { name: "Open reminder" }));
  expect(screen.getByText(/Let's make pasta together this weekend/)).toBeTruthy();
  expect(screen.getByText(/Synthetic rehearsal message/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Message Maya ↗" }).getAttribute("href")).toMatch(/^sms:\?body=Hey%20Maya/);
  expect(screen.getByRole("button", { name: "Make a recipe" })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByRole("button", { name: "Make a recipe" }));
  await screen.findByText("Pasta together");
  expect(screen.getByText("Boil water and salt it.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Place TEST order/ })).toBeNull();
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ connectionToken: "signed-owner-connection", action: "recipe" });

  fireEvent.click(screen.getByRole("button", { name: "Shop supplies" }));
  await screen.findByText("Pasta supplies");
  expect(screen.getByText("Durum wheat pasta")).toBeTruthy();
  expect(screen.getByText("Listed $15.99")).toBeTruthy();
  expect(screen.getByRole("link", { name: "View offer ↗" }).getAttribute("href")).toBe("https://example.com/pasta");
  expect(screen.queryByText("Boil water and salt it.")).toBeNull();
  expect(screen.getByRole("link", { name: "Message Maya ↗" }).getAttribute("href")).toContain("Want%20to%20cook%20together");
  expect(JSON.parse(fetcher.mock.calls[3][1]!.body as string)).toEqual({ connectionToken: "signed-owner-connection", action: "shop" });
  expect(screen.queryByRole("button", { name: /Place TEST order/ })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("shows search-derived nearby places and clears earlier shopping offers when changing action", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (url === "/api/context/prepare") return Response.json({ ready: true });
    if (url === "/api/demo/ar/scan") return Response.json(scan);
    return Response.json(JSON.parse(options!.body as string).action === "nearby" ? nearby : shop);
  });
  start(fetcher); await screen.findByText("Look around. Remember someone."); await openScan();
  fireEvent.click(screen.getByRole("button", { name: "Shop supplies" }));
  await screen.findByText("Durum wheat pasta");
  fireEvent.click(screen.getByRole("button", { name: "Find nearby" }));
  const link = await screen.findByRole("link", { name: "Open Maps search ↗" });
  expect(link.getAttribute("href")).toBe(nearby.nearby.url);
  expect(screen.getByText("Local Market")).toBeTruthy();
  expect(screen.getByText("123 Peach Street")).toBeTruthy();
  expect(screen.getByRole("link", { name: "View source ↗" }).getAttribute("href")).toBe("https://example.com/market");
  expect(screen.queryByText("Durum wheat pasta")).toBeNull();
  expect(screen.queryByRole("button", { name: /Place TEST order/ })).toBeNull();
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).action).toBe("nearby");
});

it("shows a search link when an ingredient has no verified offer", async () => {
  const noOffers = { ...shop, shopping: { allIngredientsHaveOffers: false, ingredients: [{ ...shop.shopping.ingredients[0], offers: [], status: "no_verified_offers" }] } };
  const fetcher = vi.fn<typeof fetch>(async (url) => url === "/api/context/prepare" ? Response.json({ ready: true })
    : url === "/api/demo/ar/scan" ? Response.json(scan) : Response.json(noOffers));
  start(fetcher); await screen.findByText("Look around. Remember someone."); await openScan();
  fireEvent.click(screen.getByRole("button", { name: "Shop supplies" }));
  await screen.findByText(/No verified offer found/);
  expect(screen.getByRole("link", { name: "Search this ingredient ↗" }).getAttribute("href")).toBe("https://www.google.com/search?tbm=shop&q=Pasta");
  expect(screen.queryByRole("button", { name: /Place TEST order/ })).toBeNull();
});

it("requests location only on the nearby tap and waits before asking for places", async () => {
  let succeed!: PositionCallback;
  const getCurrentPosition = vi.fn((success: PositionCallback) => { succeed = success; });
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  const fetcher = vi.fn<typeof fetch>(async (url) => url === "/api/context/prepare" ? Response.json({ ready: true })
    : url === "/api/demo/ar/scan" ? Response.json(scan) : Response.json(nearby));
  start(fetcher); await screen.findByText("Look around. Remember someone."); await openScan();
  expect(getCurrentPosition).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Find nearby" }));
  expect(screen.getByRole("status").textContent).toBe("Finding your location…");
  expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Find nearby" }).hasAttribute("disabled")).toBe(true);
  await act(async () => { succeed({ coords: { latitude: 33.7756, longitude: -84.3963 } } as GeolocationPosition); });
  await screen.findByText("Local Market");
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ connectionToken: "signed-owner-connection", action: "nearby",
    location: { latitude: 33.7756, longitude: -84.3963 } });
});

it.each([["denied", 1], ["timed out", 3]])("falls back to Georgia Tech when location is %s", async (_state, code) => {
  const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => error({ code } as GeolocationPositionError));
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  const fetcher = vi.fn<typeof fetch>(async (url) => url === "/api/context/prepare" ? Response.json({ ready: true })
    : url === "/api/demo/ar/scan" ? Response.json(scan) : Response.json({ ...nearby, nearby: { ...nearby.nearby,
      locationLabel: "Klaus CS building, Georgia Tech, Atlanta", usedFallback: true } }));
  start(fetcher); await screen.findByText("Look around. Remember someone."); await openScan();
  fireEvent.click(screen.getByRole("button", { name: "Find nearby" }));
  await screen.findByText(/Location unavailable\. Showing places near Klaus CS building/);
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ connectionToken: "signed-owner-connection", action: "nearby" });
});

it("ignores a late location callback after the camera source changes", async () => {
  let succeed!: PositionCallback;
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (success: PositionCallback) => { succeed = success; } } });
  const fetcher = vi.fn<typeof fetch>(async (url) => url === "/api/context/prepare" ? Response.json({ ready: true })
    : url === "/api/demo/ar/scan" ? Response.json(scan) : Response.json(nearby));
  start(fetcher); await screen.findByText("Look around. Remember someone."); await openScan();
  fireEvent.click(screen.getByRole("button", { name: "Find nearby" }));
  act(() => { state.props!.onPhotoSelected!(new File(["different view"], "next.jpg", { type: "image/jpeg" })); });
  await act(async () => { succeed({ coords: { latitude: 33.7756, longitude: -84.3963 } } as GeolocationPosition); });
  expect(fetcher.mock.calls.filter(([url]) => url === "/api/ar/activity")).toHaveLength(0);
});

it("does not invent actions for an explicit empty suggestion list", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) => url === "/api/context/prepare" ? Response.json({ ready: true })
    : Response.json({ ...scan, memory: { ...scan.memory, suggestedActions: [] } }));
  start(fetcher); await screen.findByText("Look around. Remember someone."); await openScan();
  expect(screen.queryByText("WHAT WOULD YOU LIKE TO DO?")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("shows an identified object without inventing a connection or activity", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) => url === "/api/context/prepare" ? Response.json({ ready: false })
    : Response.json({ detected: true, matched: false, memoryStatus: "no_match", identification: { item: "water bottle", confidence: .97, boundingBox: null } }));
  start(fetcher); await screen.findByText("Look around. Remember someone."); await openScan();
  expect(screen.getByText("No connection found in your prepared memories.")).toBeTruthy();
  expect(screen.queryByText("WHAT WOULD YOU LIKE TO DO?")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("retries only the failed action and ignores a late response after target loss", async () => {
  const late = deferred(); let attempts = 0;
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (url === "/api/context/prepare") return Response.json({ ready: true });
    if (url === "/api/demo/ar/scan") return Response.json(scan);
    if (url === "/api/ar/activity") { attempts++; return attempts === 1 ? Response.json({ error: "Try again" }, { status: 503 }) : late.promise; }
    throw new Error(`Unexpected request: ${url}`);
  });
  start(fetcher); await screen.findByText("Look around. Remember someone."); await openScan();
  fireEvent.click(screen.getByRole("button", { name: "Make a recipe" }));
  await screen.findByRole("button", { name: "Retry Make a recipe" });
  fireEvent.click(screen.getByRole("button", { name: "Retry Make a recipe" }));
  await waitFor(() => expect(attempts).toBe(2));
  expect(screen.getByRole("button", { name: "Shop supplies" }).hasAttribute("disabled")).toBe(true);
  act(() => { state.props!.onTargetLost!(); });
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  await act(async () => { late.resolve(Response.json(recipe)); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Open reminder" })).toBeNull();
  expect(fetcher.mock.calls.at(-1)![1]!.signal?.aborted).toBe(true);
});
