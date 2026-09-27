// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ScanResult } from "../src/lib/scan-types";
import { ScanAR } from "../src/components/ar/scan-ar";

const mocks = vi.hoisted(() => ({ push: vi.fn(), shopping: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/ar/ar-shopping", () => ({ useArShopping: mocks.shopping }));
vi.mock("@/components/ar/target-ar", () => ({
  TargetAR: (props: { target: string; initialImageUrl?: string; connection?: { personName: string; reason: string; onOpen: () => void }; shopping?: { status: string } }) =>
    <div data-testid="target-ar" data-target={props.target} data-image={props.initialImageUrl} data-shopping={props.shopping?.status ?? "none"}>
      <span>{props.connection?.personName}</span><span>{props.connection?.reason}</span>
      <button onClick={props.connection?.onOpen}>Open connection</button>
    </div>,
}));

const id = "9ee50000-0000-4000-8000-000000000001";
const result: ScanResult = {
  status: "matched", scanId: id, persisted: true, observedEntity: "coffee", category: "drink",
  entityKind: "object", person: "maya", personName: "Maya", relation: "wanted", reason: "Maya asked you to find coffee.",
};

function savedResponse(value: ScanResult = result) {
  return Response.json({ scan: { id, result: value, imageUrl: "https://example.test/signed-photo.jpg" } });
}

beforeEach(() => {
  mocks.push.mockReset(); mocks.shopping.mockReset();
  mocks.shopping.mockReturnValue({ status: "ready", title: "Coffee" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens an authenticated saved scan with its visual target, connection, and eligible gift shopping", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => savedResponse());
  vi.stubGlobal("fetch", fetcher);
  render(<ScanAR scanId={id} />);
  const view = await screen.findByTestId("target-ar");
  expect(fetcher).toHaveBeenCalledWith(`/api/scans/${id}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(view.getAttribute("data-target")).toBe("coffee");
  expect(view.getAttribute("data-image")).toBe("https://example.test/signed-photo.jpg");
  expect(view.getAttribute("data-shopping")).toBe("ready");
  expect(screen.getByText("Maya asked you to find coffee.")).toBeTruthy();
  expect(mocks.shopping).toHaveBeenLastCalledWith(id, { kind: "gift", personId: "maya" });
  fireEvent.click(screen.getByRole("button", { name: "Open connection" }));
  expect(mocks.push).toHaveBeenCalledWith(`/?scan=${id}`);
});

it("uses the supported category when a specific observed product has no detector class", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => savedResponse({ ...result, observedEntity: "Cafe Blend No. 4", category: "coffee cup" })));
  render(<ScanAR scanId={id} />);
  expect((await screen.findByTestId("target-ar")).getAttribute("data-target")).toBe("coffee cup");
});

it("does not shop from an inspired relationship, but permits an explicit self request", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => savedResponse({ ...result, relation: "inspired" })));
  const first = render(<ScanAR scanId={id} />);
  expect((await screen.findByTestId("target-ar")).getAttribute("data-shopping")).toBe("none");
  expect(mocks.shopping).toHaveBeenLastCalledWith(undefined, undefined);
  first.unmount();
  render(<ScanAR scanId={id} selfShopping />);
  expect((await screen.findByTestId("target-ar")).getAttribute("data-shopping")).toBe("ready");
  expect(mocks.shopping).toHaveBeenLastCalledWith(id, { kind: "self" });
});

it("shows an unsupported-target state without shopping or fabricating a detector class", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => savedResponse({ ...result, observedEntity: "Wingspan", category: "board game" })));
  render(<ScanAR scanId={id} />);
  await screen.findByText(/cannot track yet/);
  expect(screen.queryByTestId("target-ar")).toBeNull();
  expect(mocks.shopping).toHaveBeenLastCalledWith(undefined, undefined);
});

it("shows an authentication error and aborts an in-flight load on unmount", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: "Sign in to view this scan." }, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  render(<ScanAR scanId={id} />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/Sign in/);
  expect(screen.queryByTestId("target-ar")).toBeNull();
  cleanup();

  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const slowFetch = vi.fn<typeof fetch>(async () => pending);
  vi.stubGlobal("fetch", slowFetch);
  const view = render(<ScanAR scanId={id} />);
  await waitFor(() => expect(slowFetch).toHaveBeenCalledTimes(1));
  const signal = slowFetch.mock.calls[0][1]?.signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { resolve(savedResponse()); });
});
