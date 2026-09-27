// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TargetAR } from "../src/components/ar/target-ar";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:local-video"), revokeObjectURL: vi.fn() }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new Error("no camera")) } });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 2 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 640 });
  let paused = true;
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => { paused = false; });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { paused = true; });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => paused });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("plays a local clip through the camera surface and resets context on replay or source switch", async () => {
  const onDetectedFrame = vi.fn();
  const onPhotoSelected = vi.fn();
  const onTargetLost = vi.fn();
  render(<TargetAR target="" generalScan autoLocate={false} onDetectedFrame={onDetectedFrame} onPhotoSelected={onPhotoSelected} onTargetLost={onTargetLost} />);
  await screen.findByText(/Camera unavailable/);
  const clip = new File(["local clip"], "walk.mov", { type: "video/quicktime" });
  fireEvent.change(screen.getByLabelText("Choose local video"), { target: { files: [clip] } });
  await screen.findByRole("button", { name: "Pause" });
  expect(URL.createObjectURL).toHaveBeenCalledWith(clip);
  expect(onPhotoSelected).not.toHaveBeenCalled();
  expect(onDetectedFrame).not.toHaveBeenCalledWith(clip, expect.anything(), expect.anything());

  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Replay" }));
  await screen.findByRole("button", { name: "Pause" });
  expect(onTargetLost).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Restart camera" }));
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-video"));
  expect(onTargetLost).toHaveBeenCalledTimes(2);
});
