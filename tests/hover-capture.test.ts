import { describe, expect, it } from "vitest";
import { HoverCaptureController, type HoverFrame } from "../src/lib/hover-capture";

function view(seed: number): HoverFrame {
  const pixels = Uint8Array.from({ length: 24 * 18 }, (_, index) => 55 + ((index * 47 + seed * 91 + Math.floor(index / 24) * seed * 19) % 155));
  const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  const contrast = Math.sqrt(pixels.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pixels.length);
  return { pixels, mean, contrast };
}

function settle(controller: HoverCaptureController, frame: HoverFrame, start: number, eligible = true) {
  controller.observe(frame, start, eligible);
  controller.observe(frame, start + 160, eligible);
  return controller.observe(frame, start + 480, eligible);
}

function brighten(frame: HoverFrame, amount: number): HoverFrame {
  return { ...frame, pixels: Uint8Array.from(frame.pixels, (pixel) => Math.min(255, pixel + amount)), mean: frame.mean + amount };
}

describe("hover capture controller", () => {
  it("requires a stable view for 400 ms and waits through motion", () => {
    const controller = new HoverCaptureController();
    expect(controller.observe(view(1), 0, true).capture).toBe(false);
    expect(controller.observe(view(2), 160, true).status).toBe("moving");
    expect(controller.observe(view(2), 320, true).capture).toBe(false);
    expect(controller.observe(view(2), 640, true).capture).toBe(true);
  });

  it("rejects a slow cumulative pan even when adjacent frame changes are small", () => {
    const controller = new HoverCaptureController();
    const base = view(1);
    controller.observe(base, 0, true);
    controller.observe(brighten(base, 4), 160, true);
    controller.observe(brighten(base, 8), 320, true);
    expect(controller.observe(brighten(base, 12), 480, true)).toMatchObject({ status: "moving", capture: false });
    expect(controller.remaining).toBe(12);
  });

  it("rejects dark and featureless views", () => {
    const controller = new HoverCaptureController();
    const dark: HoverFrame = { pixels: Uint8Array.from({ length: 432 }, (_, i) => i % 2 ? 0 : 50), mean: 25, contrast: 25 };
    const blank: HoverFrame = { pixels: new Uint8Array(432).fill(100), mean: 100, contrast: 0 };
    expect(settle(controller, dark, 0).status).toBe("too_dark");
    expect(settle(controller, blank, 1000).status).toBe("no_detail");
    expect(controller.remaining).toBe(12);
  });

  it("allows one in flight and never repeats a captured view after completion", () => {
    const controller = new HoverCaptureController();
    expect(settle(controller, view(1), 0).capture).toBe(true);
    expect(settle(controller, view(2), 1000).capture).toBe(false);
    expect(controller.waitingForCapture).toBe(true);
    controller.completeCapture();
    expect(settle(controller, view(1), 4000).status).toBe("seen");
    expect(controller.remaining).toBe(11);
  });

  it("enforces cooldown even for a new steady view", () => {
    const controller = new HoverCaptureController();
    expect(settle(controller, view(1), 0).capture).toBe(true);
    controller.completeCapture();
    expect(settle(controller, view(2), 1000).status).toBe("cooldown");
    expect(settle(controller, view(2), 3200).capture).toBe(true);
  });

  it("honors blocking and requires an explicit budget renewal after twelve captures", () => {
    const controller = new HoverCaptureController();
    expect(settle(controller, view(1), 0, false).capture).toBe(false);
    for (let index = 1; index <= 12; index++) {
      expect(settle(controller, view(index), index * 4000).capture).toBe(true);
      controller.completeCapture();
    }
    expect(controller.remaining).toBe(0);
    expect(settle(controller, view(13), 52000).status).toBe("limit");
    controller.resumeBudget();
    expect(controller.remaining).toBe(12);
    expect(settle(controller, view(1), 56000).status).toBe("seen");
    expect(settle(controller, view(13), 60000).capture).toBe(true);
  });

  it("signals a meaningful scene change once, even during a scan", () => {
    const controller = new HoverCaptureController();
    expect(settle(controller, view(1), 0).capture).toBe(true);
    expect(controller.observe(view(2), 640, false).sceneChanged).toBe(false);
    expect(controller.observe(view(2), 800, false).sceneChanged).toBe(true);
    expect(controller.observe(view(2), 960, false).sceneChanged).toBe(false);
    expect(controller.observe(view(1), 1120, false).sceneChanged).toBe(false);
  });

  it("restores a remembered view after departure without another capture, even at the cost limit", () => {
    const controller = new HoverCaptureController();
    const first = settle(controller, view(1), 0);
    expect(first.viewId).toBe(1);
    controller.completeCapture();
    for (let index = 2; index <= 12; index++) {
      expect(settle(controller, view(index), index * 4000).capture).toBe(true);
      controller.completeCapture();
    }
    expect(controller.remaining).toBe(0);
    controller.observe(view(13), 50000, true);
    expect(controller.observe(view(13), 50160, true).sceneChanged).toBe(true);
    expect(settle(controller, view(1), 51000)).toMatchObject({ status: "seen", capture: false, viewId: first.viewId, revisited: true });
    expect(controller.observe(view(1), 51640, true).revisited).toBe(false);
  });

  it("forgets old view fingerprints on a memory revision without renewing the budget", () => {
    const controller = new HoverCaptureController();
    expect(settle(controller, view(1), 0).capture).toBe(true);
    controller.completeCapture();
    controller.resetViews();
    expect(controller.remaining).toBe(11);
    expect(settle(controller, view(1), 4000)).toMatchObject({ capture: true, viewId: 2 });
  });

  it("forgets a failed server check but keeps it in the paid-call budget", () => {
    const controller = new HoverCaptureController();
    expect(settle(controller, view(1), 0).capture).toBe(true);
    controller.discardCapture();
    expect(controller.remaining).toBe(11);
    expect(settle(controller, view(1), 4000)).toMatchObject({ capture: true, viewId: 2 });
  });

  it("refunds the budget if local image encoding failed before any request", () => {
    const controller = new HoverCaptureController();
    expect(settle(controller, view(1), 0).capture).toBe(true);
    controller.failCapture();
    expect(controller.remaining).toBe(12);
  });
});
