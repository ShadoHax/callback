"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { downscaleFile, frameFromVideo } from "@/lib/client-image";
import { grayscaleFrame, HOVER_SESSION_LIMIT, HoverCaptureController, type HoverStatus } from "@/lib/hover-capture";

export type CaptureSource = "phone_camera" | "phone_upload";
export type CaptureMode = "manual" | "hover";
type CameraState = "starting" | "live" | "denied" | "unavailable";
type CameraProps = {
  frozenUrl: string;
  busy: boolean;
  // Return false for a failed server check so that view may be retried after an explicit error reset.
  onCapture: (file: File, source: CaptureSource, mode?: CaptureMode, viewId?: number) => void | boolean | Promise<void | boolean>;
  onError: (message: string) => void;
  hoverReady?: boolean;
  hoverBlocked?: boolean;
  onHoverStart?: () => void;
  onSceneChange?: () => void;
  onRevisit?: (viewId: number) => void;
  hoverRevision?: string;
  children?: ReactNode;
};

const HOVER_SAMPLE_MS = 160;
const SAMPLE_WIDTH = 24;
const SAMPLE_HEIGHT = 18;

const hints: Record<HoverStatus, string> = {
  moving: "Move slowly",
  hold: "Hold steady",
  steady: "Checking view",
  seen: "Already checked this view",
  cooldown: "Ready for a new view",
  busy: "Checking view",
  limit: "Paused after 12 checks",
  too_dark: "Find more light",
  no_detail: "Point at something with detail",
};

// Hover scans are an opt-in stability trigger. The browser does no object recognition.
export function Camera({ frozenUrl, busy, onCapture, onError, hoverReady = true, hoverBlocked = false, onHoverStart, onSceneChange, onRevisit, hoverRevision, children }: CameraProps) {
  const video = useRef<HTMLVideoElement>(null);
  const sampler = useRef<HTMLCanvasElement | null>(null);
  const controller = useRef(new HoverCaptureController());
  const pending = useRef(false);
  const sawBusy = useRef(false);
  const [state, setState] = useState<CameraState>("starting");
  const [visible, setVisible] = useState(true);
  const [hoverEnabled, setHoverEnabled] = useState(false);
  const [everStarted, setEverStarted] = useState(false);
  const [hoverStatus, setHoverStatus] = useState<HoverStatus>("hold");
  const [remaining, setRemaining] = useState(HOVER_SESSION_LIMIT);
  // Inbox/realtime updates re-render the scanner. Keep the sampling interval stable
  // and read the newest handlers without tearing down the live-camera loop.
  const handlers = useRef({ onCapture, onError, onSceneChange, onRevisit });
  useEffect(() => { handlers.current = { onCapture, onError, onSceneChange, onRevisit }; }, [onCapture, onError, onSceneChange, onRevisit]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { const timer = setTimeout(() => setState("unavailable"), 0); return () => clearTimeout(timer); }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((media) => {
        if (cancelled) { media.getTracks().forEach((track) => track.stop()); return; }
        stream = media;
        if (video.current) { video.current.srcObject = media; void video.current.play().catch(() => {}); }
        setState("live");
      })
      .catch((cause: unknown) => { if (!cancelled) setState(cause instanceof DOMException && cause.name === "NotAllowedError" ? "denied" : "unavailable"); });
    return () => { cancelled = true; stream?.getTracks().forEach((track) => track.stop()); };
  }, []);

  useEffect(() => {
    const update = () => {
      const shown = document.visibilityState === "visible";
      setVisible(shown);
      controller.current.resetStability();
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (busy && pending.current) sawBusy.current = true;
    if (!busy && sawBusy.current) {
      controller.current.completeCapture();
      pending.current = false;
      sawBusy.current = false;
    }
  }, [busy]);

  useEffect(() => { controller.current.resetViews(); }, [hoverRevision]);

  useEffect(() => {
    if (!hoverEnabled || !visible || state !== "live") return;
    const tick = () => {
      const live = video.current;
      if (!live || live.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !live.videoWidth) return;
      try {
        if (!sampler.current) {
          sampler.current = document.createElement("canvas");
          sampler.current.width = SAMPLE_WIDTH;
          sampler.current.height = SAMPLE_HEIGHT;
        }
        const context = sampler.current.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(live, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const frame = grayscaleFrame(context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT));
        const observation = controller.current.observe(frame, performance.now(), hoverReady && !hoverBlocked && !busy);
        setHoverStatus(observation.status);
        setRemaining(observation.remaining);
        if (observation.sceneChanged) handlers.current.onSceneChange?.();
        if (observation.revisited && observation.viewId !== undefined) handlers.current.onRevisit?.(observation.viewId);
        if (!observation.capture) return;
        pending.current = true;
        void frameFromVideo(live).then((file) => {
          let result: void | boolean | Promise<void | boolean>;
          try { result = handlers.current.onCapture(file, "phone_camera", "hover", observation.viewId); }
          catch (cause) {
            controller.current.discardCapture();
            pending.current = false;
            sawBusy.current = false;
            handlers.current.onError(cause instanceof Error ? cause.message : "Could not check this view.");
            return;
          }
          const finish = (accepted: void | boolean) => {
            if (accepted === false) controller.current.discardCapture();
            else controller.current.completeCapture();
            pending.current = false;
            sawBusy.current = false;
          };
          if (result && typeof result === "object" && typeof result.then === "function") {
            void Promise.resolve(result).then(
              finish,
              (cause: unknown) => { controller.current.discardCapture(); pending.current = false; sawBusy.current = false; handlers.current.onError(cause instanceof Error ? cause.message : "Could not check this view."); },
            );
          } else if (typeof result === "boolean") finish(result);
          // A void callback is released when its busy=true/false lifecycle finishes.
        }).catch((cause: unknown) => {
          controller.current.failCapture();
          pending.current = false;
          sawBusy.current = false;
          setRemaining(controller.current.remaining);
          handlers.current.onError(cause instanceof Error ? cause.message : "Could not capture the view.");
        });
      } catch (cause) { handlers.current.onError(cause instanceof Error ? cause.message : "Could not read the camera view."); }
    };
    const timer = window.setInterval(tick, HOVER_SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [hoverEnabled, visible, state, hoverReady, hoverBlocked, busy]);

  function toggleHover() {
    if (remaining === 0) {
      controller.current.resumeBudget();
      setRemaining(controller.current.remaining);
      setHoverStatus("hold");
      setHoverEnabled(true);
      return;
    }
    if (hoverEnabled) {
      setHoverEnabled(false);
      controller.current.resetStability();
    } else {
      setEverStarted(true); onHoverStart?.();
      controller.current.resetStability();
      setHoverStatus("hold");
      setHoverEnabled(true);
    }
  }

  async function shoot() {
    if (!video.current || busy || controller.current.waitingForCapture) return;
    setHoverEnabled(false);
    controller.current.resetStability();
    try { await onCapture(await frameFromVideo(video.current), "phone_camera", "manual"); } catch (cause) { onError(cause instanceof Error ? cause.message : "Could not capture the photo."); }
  }
  async function pick(file: File | undefined, source: CaptureSource) {
    if (!file) return;
    setHoverEnabled(false);
    controller.current.resetStability();
    try { await onCapture(await downscaleFile(file), source, "manual"); } catch (cause) { onError(cause instanceof Error ? cause.message : "Could not read that photo."); }
  }

  const showLive = hoverEnabled && state === "live";
  const showFrozen = Boolean(frozenUrl) && !showLive;
  const hint = !visible ? "Paused while tab is hidden" : !hoverReady ? "Preparing context…" : hoverBlocked ? "Paused" : remaining === 0 ? hints.limit : hints[hoverStatus];

  return <div className="camera">
    {state === "live" && <div className="mb-3">
      <button type="button" className="w-full rounded-xl border border-[#ddd5ca] bg-white px-4 py-3 text-sm font-bold text-[#201d1a]" aria-pressed={hoverEnabled} onClick={toggleHover}>
        {remaining === 0 ? "Resume hover · 12 more checks" : hoverEnabled ? "Pause hover" : everStarted ? "Resume hover" : "Start hover"}
      </button>
      <p className="mt-1 text-center text-xs text-[#786e64]">Steady views are checked with AI. Tap a preview to save it.</p>
    </div>}
    <div className={`viewport${busy && !showLive ? " scanning" : ""}${showFrozen ? " compact" : ""}`}>
      <video ref={video} playsInline muted autoPlay aria-label="Camera viewfinder" className={state === "live" && !showFrozen ? "" : "hidden"} />
      {showFrozen && <Image src={frozenUrl} alt="The photo being scanned" fill unoptimized className="frozen" />}
      {!showFrozen && state !== "live" && <div className="viewport-empty">
        {state === "starting" ? <p>Starting camera…</p> : <>
          <p>{state === "denied" ? "Camera permission was denied. You can still take or choose a photo." : "Live camera needs HTTPS. You can still take or choose a photo."}</p>
          <label className="pill-button">Take a photo<input type="file" accept="image/*" capture="environment" onChange={(event) => { void pick(event.target.files?.[0], "phone_camera"); event.target.value = ""; }} /></label>
        </>}
      </div>}
      {showLive && <>
        <div className="pointer-events-none absolute inset-[18%] z-10 rounded-[28px] border border-white/60 shadow-[0_0_0_999px_#00000016]" aria-hidden />
        <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-full bg-black/60 px-3 py-2 text-xs font-bold text-white" role="status">{hint} · {remaining} left</div>
      </>}
      {children}
      {busy && !showLive && <div className="scan-line" aria-hidden />}
      {state === "live" && !showFrozen && <button className="shutter" aria-label="Scan this" disabled={busy} onClick={() => void shoot()}><span /></button>}
    </div>
    {!showFrozen && <label className="upload-link">or choose a photo<input type="file" accept="image/*" onChange={(event) => { void pick(event.target.files?.[0], "phone_upload"); event.target.value = ""; }} /></label>}
  </div>;
}
