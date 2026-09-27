// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Camera } from "../src/components/camera";
import type { CaptureMode, CaptureSource } from "../src/components/camera";

vi.mock("../src/lib/client-image", () => ({
  frameFromVideo: vi.fn(async () => new File(["frame"], "frame.jpg", { type: "image/jpeg" })),
  downscaleFile: vi.fn(async (file: File) => file),
}));

let seed = 1;
let visibility = "visible";
const capture = vi.fn<(file: File, source: CaptureSource, mode?: CaptureMode, viewId?: number) => Promise<void>>(async () => {});
const sceneChange = vi.fn();
const revisit = vi.fn();
const hoverStart = vi.fn();
const media = { getTracks: () => [{ stop: vi.fn() }] };

function sampledPixels() {
  const data = new Uint8ClampedArray(24 * 18 * 4);
  for (let index = 0; index < 24 * 18; index++) {
    const value = 55 + ((index * 47 + seed * 91 + Math.floor(index / 24) * seed * 19) % 155);
    data.set([value, value, value, 255], index * 4);
  }
  return { width: 24, height: 18, data } as ImageData;
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  seed = 1; visibility = "visible";
  capture.mockClear(); sceneChange.mockClear(); revisit.mockClear(); hoverStart.mockClear();
  vi.useFakeTimers();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => media) } });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, "readyState", { configurable: true, get: () => 2 });
  vi.spyOn(HTMLVideoElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
    drawImage: vi.fn(),
    getImageData: sampledPixels,
  }) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("stays opt-in and waits for knowledge readiness before a hover capture", async () => {
  const { rerender } = render(<Camera frozenUrl="" busy={false} hoverReady={false} onCapture={capture} onError={vi.fn()} onHoverStart={hoverStart} />);
  await advance(0);
  await advance(1200);
  expect(capture).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start hover" }));
  expect(hoverStart).toHaveBeenCalledTimes(1);
  await advance(1000);
  expect(capture).not.toHaveBeenCalled();
  expect(screen.getByText(/Preparing context/)).toBeTruthy();
  rerender(<Camera frozenUrl="" busy={false} hoverReady onCapture={capture} onError={vi.fn()} onHoverStart={hoverStart} />);
  await advance(640);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture.mock.calls[0][2]).toBe("hover");
  await advance(4000);
  expect(capture).toHaveBeenCalledTimes(1);
});

it("blocks scans while busy or hidden and announces a changed view once", async () => {
  const { rerender } = render(<Camera frozenUrl="" busy={false} hoverBlocked onCapture={capture} onError={vi.fn()} onSceneChange={sceneChange} onRevisit={revisit} />);
  await advance(0);
  fireEvent.click(screen.getByRole("button", { name: "Start hover" }));
  await advance(1000);
  expect(capture).not.toHaveBeenCalled();
  rerender(<Camera frozenUrl="" busy={false} hoverBlocked={false} onCapture={capture} onError={vi.fn()} onSceneChange={sceneChange} onRevisit={revisit} />);
  await advance(640);
  expect(capture).toHaveBeenCalledTimes(1);
  seed = 2;
  await advance(480);
  expect(sceneChange).toHaveBeenCalledTimes(1);
  seed = 1;
  await advance(640);
  expect(revisit).toHaveBeenCalledTimes(1);
  expect(revisit).toHaveBeenCalledWith(capture.mock.calls[0][3]);
  expect(capture).toHaveBeenCalledTimes(1);
  visibility = "hidden";
  fireEvent(document, new Event("visibilitychange"));
  seed = 3;
  await advance(5000);
  expect(capture).toHaveBeenCalledTimes(1);
  visibility = "visible";
  fireEvent(document, new Event("visibilitychange"));
  rerender(<Camera frozenUrl="" busy onCapture={capture} onError={vi.fn()} onSceneChange={sceneChange} onRevisit={revisit} />);
  await advance(640);
  expect(capture).toHaveBeenCalledTimes(1);
});
