// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import Scanner from "../src/app/page";
import type { ScanResult } from "../src/lib/scan-types";

type MockCameraProps = {
  children?: ReactNode;
  onCapture: (file: File, source: "phone_camera", mode: "manual" | "hover", viewId?: number) => Promise<boolean>;
  onHoverStart: () => void;
  onSceneChange: () => void;
  onRevisit: (viewId: number) => void;
  hoverReady: boolean;
  hoverBlocked: boolean;
  hoverRevision: string;
};
let camera: MockCameraProps;

vi.mock("@/components/camera", () => ({
  Camera: (props: MockCameraProps) => {
    camera = props;
    return <div data-testid="mock-camera" data-ready={props.hoverReady} data-blocked={props.hoverBlocked}>{props.children}</div>;
  },
}));
vi.mock("@/components/stages", () => ({ Stages: () => <div data-testid="stages" /> }));
vi.mock("@/components/connection", () => ({
  ConnectionCard: () => <div data-testid="saved-connection" />,
  RuledOutList: () => <div data-testid="ruled-out" />,
  Confidence: () => null,
}));
vi.mock("@/components/composer", () => ({ Composer: () => <div data-testid="composer" /> }));
vi.mock("@/components/shopping", () => ({ Shopping: () => <div data-testid="shopping" /> }));
vi.mock("@/lib/use-inbox", () => ({ useInbox: () => ({ messages: [], userId: "alex", loading: false, error: "", refresh: async () => {} }) }));
vi.mock("@/lib/alert", () => ({ alertIncoming: () => {}, unlockAlerts: () => {} }));

const preview: ScanResult = {
  status: "matched", scanId: "preview-1", persisted: false, previewToken: "signed-preview-token",
  observedEntity: "Wingspan", person: "maya", personName: "Maya", reason: "You planned to play together.",
  recipientId: "maya-account", relation: "planned_together",
};
const saved: ScanResult = { ...preview, scanId: "saved-1", persisted: true, previewToken: undefined };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it("keeps an in-flight hover result cached after movement, reuses it on revisit, and saves only on tap", async () => {
  const pendingScan = deferred<Response>();
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === "/api/demo/context") return Response.json({ enabled: false });
    if (url === "/api/model/config") return Response.json({});
    if (url === "/api/context/prepare") return Response.json({ ready: true, revision: "memory-v1" });
    if (url === "/api/scans") return pendingScan.promise;
    if (url === "/api/scans/save") return Response.json({ result: saved });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  class TestURL extends URL {
    static createObjectURL = vi.fn(() => "blob:test-photo");
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", TestURL);

  render(<Scanner />);
  expect(fetcher.mock.calls.filter(([input]) => String(input) === "/api/scans")).toHaveLength(0);
  await waitFor(() => expect(screen.getByTestId("mock-camera").getAttribute("data-ready")).toBe("true"));
  expect(fetcher.mock.calls.filter(([input]) => String(input) === "/api/context/prepare")).toHaveLength(1);
  await act(async () => { camera.onHoverStart(); });
  expect(fetcher.mock.calls.filter(([input]) => String(input) === "/api/context/prepare")).toHaveLength(1);

  const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
  let scanPromise!: Promise<boolean>;
  await act(async () => { scanPromise = camera.onCapture(file, "phone_camera", "hover", 101); });
  expect(fetcher.mock.calls.filter(([input]) => String(input) === "/api/scans")).toHaveLength(1);
  act(() => { camera.onSceneChange(); });
  await act(async () => {
    pendingScan.resolve(new Response(`${JSON.stringify({ type: "result", result: preview })}\n`));
    expect(await scanPromise).toBe(true);
  });
  expect(screen.queryByText("Tap to open this connection")).toBeNull();
  expect(screen.queryByTestId("saved-connection")).toBeNull();
  expect(screen.queryByTestId("composer")).toBeNull();
  expect(screen.queryByTestId("shopping")).toBeNull();

  act(() => { camera.onRevisit(101); });
  expect(screen.getByText("Tap to open this connection")).toBeTruthy();
  expect(screen.getByText(/Unsaved preview/)).toBeTruthy();
  expect(screen.queryByTestId("saved-connection")).toBeNull();
  expect(screen.queryByTestId("composer")).toBeNull();
  expect(screen.queryByTestId("shopping")).toBeNull();
  expect(fetcher.mock.calls.filter(([input]) => String(input) === "/api/scans")).toHaveLength(1);

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Tap to open this connection/ })); });
  const saveCalls = fetcher.mock.calls.filter(([input]) => String(input) === "/api/scans/save");
  expect(saveCalls).toHaveLength(1);
  const saveBody = saveCalls[0][1]?.body as FormData;
  expect(saveBody.get("previewToken")).toBe("signed-preview-token");
  expect(saveBody.get("image")).toBe(file);
  expect(screen.queryByText("Tap to open this connection")).toBeNull();
  expect(screen.getByTestId("saved-connection")).toBeTruthy();
  expect(screen.getByTestId("composer")).toBeTruthy();
  expect(screen.getByTestId("shopping")).toBeTruthy();
  expect(screen.getByTestId("mock-camera").getAttribute("data-blocked")).toBe("true");
});

it("does not retry a failed automatic preparation on each hover start", async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === "/api/demo/context") return Response.json({ enabled: false });
    if (url === "/api/model/config") return Response.json({});
    if (url === "/api/context/prepare") return Response.json({ error: "Preparation failed." }, { status: 503 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);

  render(<Scanner />);
  await screen.findByText("Preparation failed.");
  act(() => { camera.onHoverStart(); camera.onHoverStart(); });
  expect(fetcher.mock.calls.filter(([input]) => String(input) === "/api/context/prepare")).toHaveLength(1);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry preparing" })); });
  expect(fetcher.mock.calls.filter(([input]) => String(input) === "/api/context/prepare")).toHaveLength(2);
});

it("keeps the previous connection open when a later model request fails", async () => {
  let scans = 0;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === "/api/demo/context") return Response.json({ enabled: false });
    if (url === "/api/model/config") return Response.json({});
    if (url === "/api/context/prepare") return Response.json({ ready: true, revision: "memory-v1" });
    if (url === "/api/scans") {
      scans++;
      return new Response(`${JSON.stringify(scans === 1
        ? { type: "result", result: saved }
        : { type: "error", message: "Model request failed (503)." })}\n`);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  class TestURL extends URL {
    static createObjectURL = vi.fn(() => `blob:photo-${TestURL.createObjectURL.mock.calls.length}`);
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", TestURL);

  render(<Scanner />);
  await waitFor(() => expect(screen.getByTestId("mock-camera").getAttribute("data-ready")).toBe("true"));
  const first = new File(["first"], "first.jpg", { type: "image/jpeg" });
  const second = new File(["second"], "second.jpg", { type: "image/jpeg" });
  await act(async () => { expect(await camera.onCapture(first, "phone_camera", "hover", 1)).toBe(true); });
  expect(screen.getByTestId("saved-connection")).toBeTruthy();

  await act(async () => { expect(await camera.onCapture(second, "phone_camera", "hover", 2)).toBe(false); });
  expect(screen.getByTestId("saved-connection")).toBeTruthy();
  expect(screen.getByText(/previous connection is still open/i)).toBeTruthy();
});

it("prepares the latest context after a demo edit completes during the first build", async () => {
  const first = deferred<Response>();
  let prepareCalls = 0;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/demo/context" && init?.method === "POST") return Response.json({ id: "new-source" }, { status: 201 });
    if (url === "/api/demo/context") return Response.json({ enabled: true });
    if (url === "/api/model/config") return Response.json({});
    if (url === "/api/context/prepare") {
      prepareCalls++;
      return prepareCalls === 1 ? first.promise : Response.json({ ready: true, revision: "memory-v2" });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);

  render(<Scanner />);
  await waitFor(() => expect(fetcher.mock.calls.filter(([input]) => String(input) === "/api/context/prepare")).toHaveLength(1));
  await screen.findByText("Demo controls");
  fireEvent.change(screen.getByRole("textbox", { name: "New message" }), { target: { value: "I bought the X100V." } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add synthetic message" })); });
  expect(fetcher.mock.calls.filter(([input]) => String(input) === "/api/context/prepare")).toHaveLength(1);
  await act(async () => { first.resolve(Response.json({ ready: true, revision: "memory-v1" })); });
  await waitFor(() => expect(fetcher.mock.calls.filter(([input]) => String(input) === "/api/context/prepare")).toHaveLength(2));
  await waitFor(() => expect(screen.getByTestId("mock-camera").getAttribute("data-ready")).toBe("true"));
  expect(camera.hoverRevision).toBe("memory-v2");
  expect(screen.getByText(/Memory ready/)).toBeTruthy();
});

it.each([true, false])("recovers stale memory without auto-rescanning (previous saved connection: %s)", async (hasPrevious) => {
  const refresh = deferred<Response>();
  let preparations = 0;
  let scans = 0;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === "/api/demo/context") return Response.json({ enabled: false });
    if (url === "/api/model/config") return Response.json({});
    if (url === "/api/context/prepare") return ++preparations === 1
      ? Response.json({ ready: true, revision: "memory-v1" }) : refresh.promise;
    if (url === "/api/scans") return new Response(`${JSON.stringify(++scans === 1 && hasPrevious
      ? { type: "result", result: saved }
      : { type: "error", code: "memory_required", reason: "missing_or_stale", message: "Refresh memory, then scan again." })}\n`);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  class TestURL extends URL {
    static createObjectURL = vi.fn(() => `blob:photo-${TestURL.createObjectURL.mock.calls.length}`);
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", TestURL);

  render(<Scanner />);
  await waitFor(() => expect(camera.hoverReady).toBe(true));
  const first = new File(["first"], "first.jpg", { type: "image/jpeg" });
  const second = new File(["second"], "second.jpg", { type: "image/jpeg" });
  if (hasPrevious) await act(async () => { expect(await camera.onCapture(first, "phone_camera", "manual")).toBe(true); });
  await act(async () => { expect(await camera.onCapture(second, "phone_camera", "manual")).toBe(false); });
  if (hasPrevious) expect(screen.getByTestId("saved-connection")).toBeTruthy();
  expect(camera.hoverReady).toBe(false);
  expect(scans).toBe(hasPrevious ? 2 : 1);
  await act(async () => { refresh.resolve(Response.json({ ready: true, revision: "memory-v2" })); });
  await waitFor(() => expect(camera.hoverReady).toBe(true));
  expect(scans).toBe(hasPrevious ? 2 : 1);
  expect(screen.getByRole("button", { name: "Scan this photo" })).toBeTruthy();
  expect(screen.getByText(/Memory refreshed/)).toBeTruthy();
});
