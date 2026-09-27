"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ArShoppingState } from "./ar-shopping";
import { ObjectOverlay } from "./object-overlay";
import { detectTarget, detectTargets, detectForeground, loadTargetDetector, targetClass, targetCropRect } from "@/lib/target-detector";
import { loadOpenCV } from "@/lib/opencv-browser";
import { createArTargetTracker } from "@/lib/ar-target-tracker";
import type { NormalizedBox } from "@/lib/object-overlay";
import styles from "./target-ar.module.css";
import { capturedViewIsCurrent, LiveARCapture } from "@/lib/live-ar-capture";
import { grayscaleFrame, type HoverFrame } from "@/lib/hover-capture";
import { ArBoxStabilizer } from "@/lib/ar-box-stabilizer";

type Props = { target: string; onTargetChange?: (value: string) => void; initialImageUrl?: string;
  shopping?: ArShoppingState; connection?: { personName: string; reason: string; onOpen: () => void }; allowMotionTest?: boolean; autoLocate?: boolean;
  bananaDemo?: boolean; generalScan?: boolean; recognitionPaused?: boolean; remoteBox?: NormalizedBox | null; scanTargets?: string[]; onDetectedFrame?: (frame: Blob, score: number, label: string) => boolean | void | Promise<boolean | void>; onTargetLost?: () => void;
  compactOverlay?: { label?: string; personName?: string; memory?: string; onOpen?: () => void; testLabel?: string };
  onPhotoSelected?: (photo: File) => void; children?: React.ReactNode };

/** Matcher supplies `target`; detection + tracking never choose a relationship or a new target. */
export function TargetAR({ target, onTargetChange, initialImageUrl, connection, shopping, allowMotionTest = false, autoLocate = !onTargetChange,
  bananaDemo = false, generalScan = false, recognitionPaused = false, remoteBox, scanTargets, onDetectedFrame, onTargetLost, compactOverlay, onPhotoSelected, children }: Props) {
  const scanTargetsKey = scanTargets?.join("\u0000") ?? "";
  const phoneMode = generalScan || bananaDemo || !!scanTargetsKey;
  const sceneGate = useRef(new LiveARCapture());
  const stabilizedBox = useRef(new ArBoxStabilizer());
  const recognitionInFlight = useRef(false);
  const sentFrame = useRef<{ frame: HoverFrame; generation: number } | null>(null);
  const staleResultCleared = useRef(false);
  const connectionVisible = useRef(false);
  const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), video = useRef<HTMLVideoElement>(null);
  const photo = useRef<HTMLImageElement | null>(null), media = useRef<MediaStream | null>(null);
  const videoUrl = useRef<string | null>(null);
  const sourceRef = useRef<"photo" | "camera" | "video">("photo");
  const tracker = useRef<ReturnType<typeof createArTargetTracker> | null>(null);
  const trackerSource = useRef<"local" | "remote" | null>(null);
  const previousTarget = useRef(target), boxTargetRef = useRef("");
  const generation = useRef(0), busyRef = useRef(false), motion = useRef(false), alive = useRef(true), misses = useRef(0);
  const lastEmitted = useRef<{ label: string; at: number } | null>(null);
  const detectionCallback = useRef(onDetectedFrame), photoCallback = useRef(onPhotoSelected), lostCallback = useRef(onTargetLost);
  useEffect(() => { detectionCallback.current = onDetectedFrame; photoCallback.current = onPhotoSelected; lostCallback.current = onTargetLost; }, [onDetectedFrame, onPhotoSelected, onTargetLost]);
  useEffect(() => { connectionVisible.current = !!compactOverlay; }, [compactOverlay]);
  const [size, setSize] = useState({ width: 1, height: 1 }), [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [boxTarget, setBoxTarget] = useState("");
  const [box, setBox] = useState<NormalizedBox | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Choose a photo or start your camera."), [error, setError] = useState("");
  const [live, setLive] = useState(false), [testing, setTesting] = useState(false);
  const [sourceKind, setSourceKind] = useState<"photo" | "camera" | "video">("photo");
  const [videoPlaying, setVideoPlaying] = useState(false);

  const releaseVideo = useCallback(() => {
    if (video.current) { video.current.pause(); video.current.srcObject = null; video.current.removeAttribute("src"); video.current.load(); }
    if (videoUrl.current) URL.revokeObjectURL(videoUrl.current);
    videoUrl.current = null;
  }, []);
  const publishBox = useCallback((next: NormalizedBox, kind: "tracking" | "detection" = "tracking") => {
    setBox(stabilizedBox.current.observe(next, performance.now(), kind));
  }, []);
  const captureChanged = useCallback((reference: HoverFrame) => {
    const surface = canvas.current;
    if (!surface || !surface.width || !surface.height) return false;
    const tiny = document.createElement("canvas"); tiny.width = 32; tiny.height = 32;
    const context = tiny.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    try {
      context.drawImage(surface, 0, 0, 32, 32);
      return !capturedViewIsCurrent(reference, grayscaleFrame(context.getImageData(0, 0, 32, 32)));
    } catch { return true; }
  }, []);

  const clearTracking = useCallback((notifyLost = false) => {
    const hadTarget = !!tracker.current || !!boxTargetRef.current;
    tracker.current?.dispose(); tracker.current = null; trackerSource.current = null; boxTargetRef.current = ""; stabilizedBox.current.clear(); setBox(null); setBoxTarget("");
    lastEmitted.current = null; misses.current = 0;
    if (notifyLost && hadTarget) lostCallback.current?.();
  }, []);
  const setPhoto = useCallback(async (url: string) => {
    const run = ++generation.current; busyRef.current = false; setBusy(false); clearTracking(); motion.current = false; setTesting(false);
    sentFrame.current = null; staleResultCleared.current = false;
    media.current?.getTracks().forEach((track) => track.stop()); media.current = null; releaseVideo(); sourceRef.current = "photo"; setSourceKind("photo"); setVideoPlaying(false); setLive(false); setReady(false); setError("");
    const image = new window.Image(); image.crossOrigin = "anonymous"; image.src = url;
    try { await image.decode(); if (run !== generation.current || !alive.current) return;
      photo.current = image;
      const surface = canvas.current;
      if (surface) {
        const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
        surface.width = Math.round(image.naturalWidth * scale); surface.height = Math.round(image.naturalHeight * scale);
        surface.getContext("2d")?.drawImage(image, 0, 0, surface.width, surface.height);
        setImageSize({ width: surface.width, height: surface.height });
      }
      setReady(true); setStatus(phoneMode ? "Checking your photo…" : "Photo ready. Find the requested object.");
    } catch { if (alive.current) setError("Could not read this photo."); }
  }, [clearTracking, phoneMode, releaseVideo]);

  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => { if (initialImageUrl) void setPhoto(initialImageUrl); }, 0);
    return () => {
      alive.current = false; clearTimeout(timer);
      // Invalidate the current generation, rather than a captured DOM reference.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      tracker.current?.dispose(); media.current?.getTracks().forEach((track) => track.stop()); releaseVideo();
    };
  }, [initialImageUrl, setPhoto, releaseVideo]);
  useEffect(() => {
    // A new requested concept must never inherit the old object's box.
    if (previousTarget.current === target || scanTargetsKey || generalScan) return;
    previousTarget.current = target;
    generation.current++; busyRef.current = false;
    motion.current = false;
    const timer = setTimeout(() => { clearTracking(); setBusy(false); setTesting(false); }, 0);
    return () => clearTimeout(timer);
  }, [target, clearTracking, scanTargetsKey, generalScan]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frameId = 0, last = 0, ticks = 0;
    const draw = (now: number) => {
      frameId = requestAnimationFrame(draw);
      if (now - last < 50 || document.visibilityState !== "visible") return;
      last = now;
      const surface = canvas.current, source = sourceRef.current === "photo" ? photo.current : video.current;
      if (!surface || !source) return;
      const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
      const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
      if (!width || !height) return;
      // In phone mode detect exactly the visible camera crop, not objects outside
      // the portrait viewport's cover region. Tracking and overlays use this same frame.
      const viewport = container.current;
      const ratio = phoneMode && sourceRef.current === "camera" && viewport?.clientWidth && viewport?.clientHeight
        ? viewport.clientWidth / viewport.clientHeight : width / height;
      const cropWidth = Math.min(width, height * ratio);
      const cropHeight = Math.min(height, width / ratio);
      const scale = Math.min(1, 640 / Math.max(cropWidth, cropHeight));
      const w = Math.round(cropWidth * scale), h = Math.round(cropHeight * scale);
      if (surface.width !== w || surface.height !== h) { surface.width = w; surface.height = h; setImageSize({ width: w, height: h }); }
      const context = surface.getContext("2d", { willReadFrequently: true }); if (!context) return;
      context.fillStyle = "#080808"; context.fillRect(0, 0, w, h);
      const dx = motion.current ? Math.sin(now / 1500) * 35 : 0, dy = motion.current ? Math.sin(now / 2100) * 12 : 0;
      context.drawImage(source, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, dx, dy, w, h);
      if (tracker.current) {
        const started = performance.now();
        try {
          const tracked = tracker.current.update(context.getImageData(0, 0, w, h));
          if (tracked.status === "tracking") { publishBox(tracked.box); if (!phoneMode && ++ticks % 10 === 0) setStatus(`Tracking ${target} on device · ${(performance.now()-started).toFixed(1)} ms/frame`); }
          else if (phoneMode && !live) { tracker.current.dispose(); tracker.current = null; trackerSource.current = null; if (!generalScan) setStatus("Object located in photo."); }
          else { tracker.current.dispose(); tracker.current = null; trackerSource.current = null; if (!generalScan) setStatus(phoneMode ? "Hold steady to reacquire the object." : "Target lost. Find it again to reacquire."); }
        } catch { tracker.current?.dispose(); tracker.current = null; trackerSource.current = null; if (!generalScan) setError("Tracking paused. Hold steady to reacquire."); }
      } else if (boxTargetRef.current && live) {
        const held = stabilizedBox.current.missing(now, 1200);
        if (held) setBox(held);
        else clearTracking(!generalScan || connectionVisible.current);
      }
    };
    frameId = requestAnimationFrame(draw);
    const hidden = () => { if (document.hidden) clearTracking(live && !generalScan); };
    document.addEventListener("visibilitychange", hidden);
    return () => { cancelAnimationFrame(frameId); document.removeEventListener("visibilitychange", hidden); };
  }, [clearTracking, publishBox, target, phoneMode, live, generalScan]);

  const locate = useCallback(async () => {
    if (busyRef.current || !canvas.current || !ready) return;
    if (generalScan && tracker.current?.status === "tracking") return;
    if (!generalScan && !scanTargetsKey && !targetClass(target)) { setError(`“${target}” is not in the local detector’s classes yet. Try coffee, cup, book, bottle, or laptop.`); return; }
    const run = ++generation.current; busyRef.current = true; if (!phoneMode || !boxTargetRef.current) setBusy(true); if (!phoneMode) clearTracking(); setError("");
    if (!generalScan && (!phoneMode || !boxTargetRef.current)) setStatus("Loading on-device vision… first use downloads the models.");
    try {
      const [, cv] = await Promise.all([loadTargetDetector(), loadOpenCV()]);
      if (run !== generation.current) return;
      const captured = document.createElement("canvas"), surface = canvas.current;
      captured.width = surface.width; captured.height = surface.height;
      const ctx = captured.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("Canvas is unavailable.");
      ctx.drawImage(surface, 0, 0); const seed = ctx.getImageData(0, 0, captured.width, captured.height);
      if (!generalScan && (!phoneMode || !boxTargetRef.current)) setStatus(scanTargetsKey ? "Recognizing what you see…" : `Finding ${target} on device…`);
      const result = generalScan ? await detectForeground(captured) : scanTargetsKey ? await detectTargets(captured, scanTargetsKey.split("\u0000")) : await detectTarget(captured, target);
      if (run !== generation.current || !alive.current) return;
      if (!phoneMode) console.info("[Callback AR] detection", { targetClass: targetClass(target), status: result.status, ms: Math.round(result.ms) });
      if (result.status !== "found") {
        if (phoneMode && !generalScan && ++misses.current >= 2) clearTracking(true);
        if (!generalScan && (!phoneMode || !boxTargetRef.current)) setStatus(phoneMode ? "Hold steady or try a clearer angle." : result.message);
        return;
      }
      misses.current = 0;
      const detectedLabel = generalScan || scanTargetsKey ? result.label : target;
      if (phoneMode && boxTargetRef.current && boxTargetRef.current !== detectedLabel) clearTracking(!generalScan);
      boxTargetRef.current = detectedLabel; setBoxTarget(detectedLabel);
      const shouldEmit = !scanTargetsKey || !lastEmitted.current || lastEmitted.current.label !== detectedLabel || Date.now() - lastEmitted.current.at > 12000;
      if (!generalScan && detectionCallback.current && shouldEmit && (!scanTargetsKey || live)) {
        const emittedAt = Date.now();
        lastEmitted.current = { label: detectedLabel, at: emittedAt };
        let frameCanvas = captured;
        if (scanTargetsKey) {
          const crop = targetCropRect(result.box, captured.width, captured.height);
          frameCanvas = document.createElement("canvas");
          frameCanvas.width = crop.width; frameCanvas.height = crop.height;
          frameCanvas.getContext("2d")?.drawImage(captured, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
        }
        frameCanvas.toBlob((frame) => {
          if (frame && run === generation.current && alive.current) detectionCallback.current?.(frame, result.score, detectedLabel);
          else if (lastEmitted.current?.at === emittedAt) lastEmitted.current = null;
        }, "image/jpeg", .82);
      }
      tracker.current?.dispose();
      tracker.current = createArTargetTracker(cv, seed, result.box);
      trackerSource.current = "local";
      if (tracker.current.status === "lost") {
        tracker.current.dispose(); tracker.current = null;
        trackerSource.current = null;
        if (phoneMode) {
          // Detection still anchors a useful short-lived overlay; the next scan will refresh it.
          publishBox(result.box, "detection");
          if (!generalScan) setStatus("Object in view. Hold steady.");
        } else {
          if (!media.current) publishBox(result.box, "detection");
          setStatus(media.current ? "Not enough texture to track this target. Try another angle." : `Located ${detectedLabel}; this photo has insufficient texture for motion tracking.`);
        }
        return;
      }
      publishBox(result.box, "detection"); if (!generalScan && (!phoneMode || shouldEmit)) setStatus(phoneMode ? "Object in view. Hold steady." : `Located ${target} · ${Math.round(result.score * 100)}% detector score · ${Math.round(result.ms)} ms`);
    } catch (cause) { if (run === generation.current && alive.current && !generalScan) setError(cause instanceof Error ? cause.message : "Object detection failed."); }
    finally { if (run === generation.current && alive.current) { busyRef.current = false; setBusy(false); } }
  }, [target, ready, clearTracking, scanTargetsKey, phoneMode, live, generalScan, publishBox]);

  useEffect(() => {
    if (!autoLocate || !ready) return;
    const timer = setTimeout(() => void locate(), 0);
    return () => clearTimeout(timer);
  }, [autoLocate, ready, locate, scanTargetsKey, live]);

  useEffect(() => {
    if (!phoneMode || !live || !ready) return;
    const timer = setInterval(() => { if (!busyRef.current && tracker.current?.status !== "tracking") void locate(); }, 1300);
    return () => clearInterval(timer);
  }, [phoneMode, live, ready, locate]);

  useEffect(() => {
    if (!generalScan || !live || !ready) return;
    const gate = sceneGate.current;
    const tiny = document.createElement("canvas"); tiny.width = 32; tiny.height = 32;
    const timer = setInterval(() => {
      const surface = canvas.current, ctx = tiny.getContext("2d", { willReadFrequently: true });
      if (!surface || !ctx || document.hidden) return;
      ctx.drawImage(surface, 0, 0, 32, 32);
      const fingerprint = grayscaleFrame(ctx.getImageData(0, 0, 32, 32));
      const observation = gate.observe(fingerprint, performance.now(),
        !!detectionCallback.current && !recognitionPaused && !recognitionInFlight.current);
      if (observation.sceneChanged) {
        clearTracking(); lostCallback.current?.();
      }
      if (!observation.capture) return;
      const captured = document.createElement("canvas"); captured.width = surface.width; captured.height = surface.height;
      captured.getContext("2d")?.drawImage(surface, 0, 0);
      const run = generation.current;
      sentFrame.current = { frame: fingerprint, generation: run }; staleResultCleared.current = false;
      console.info("[Callback AR] camera frame", { width: captured.width, height: captured.height, trigger: "steady_view" });
      captured.toBlob(blob => {
        if (!blob || !alive.current || run !== generation.current) { gate.complete(); return; }
        recognitionInFlight.current = true;
        void Promise.resolve().then(() => detectionCallback.current?.(blob, 0, "scene"))
          .then(matched => {
            if (matched === false) gate.unmatched();
            else if (run === generation.current && captureChanged(fingerprint)) {
              if (!staleResultCleared.current) { staleResultCleared.current = true; clearTracking(); lostCallback.current?.(); }
              gate.unmatched();
            }
          })
          .catch(() => gate.unmatched())
          .finally(() => { recognitionInFlight.current = false; gate.complete(); });
      }, "image/jpeg", .85);
    }, 160);
    return () => clearInterval(timer);
  }, [generalScan, live, ready, clearTracking, recognitionPaused, captureChanged]);

  useEffect(() => {
    if (!generalScan || !remoteBox || !ready || !canvas.current) return;
    const sent = sentFrame.current;
    if (sourceRef.current !== "photo" && sent?.generation === generation.current && captureChanged(sent.frame)) {
      if (!staleResultCleared.current) { staleResultCleared.current = true; clearTracking(); lostCallback.current?.(); }
      return;
    }
    let cancelled = false;
    const run = generation.current;
    const current = tracker.current?.box;
    const distance = current ? Math.hypot(
      current.x + current.width / 2 - remoteBox.x - remoteBox.width / 2,
      current.y + current.height / 2 - remoteBox.y - remoteBox.height / 2,
    ) : Infinity;
    // A new result from the same tracked object must not restart optical flow.
    if (current && trackerSource.current === "remote" && distance < .16) return;
    if (distance > .25) stabilizedBox.current.clear();
    publishBox(remoteBox, "detection");
    void loadOpenCV().then(cv => {
      if (cancelled || !alive.current || run !== generation.current || !canvas.current) return;
      const surface = canvas.current;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      const seed = ctx.getImageData(0, 0, surface.width, surface.height);
      tracker.current?.dispose();
      tracker.current = createArTargetTracker(cv, seed, remoteBox);
      trackerSource.current = "remote";
    }).catch(() => { /* Recognition remains available without optical flow. */ });
    return () => { cancelled = true; };
  }, [generalScan, remoteBox, ready, publishBox, captureChanged, clearTracking]);

  async function startCamera() {
    if (busyRef.current) return;
    const run = ++generation.current; busyRef.current = true; setBusy(true);
    if (ready) lostCallback.current?.();
    sentFrame.current = null; staleResultCleared.current = false;
    clearTracking(); sceneGate.current = new LiveARCapture(); setReady(false); setLive(false); setError(""); motion.current = false; setTesting(false);
    try {
      media.current?.getTracks().forEach((track) => track.stop());
      releaseVideo(); setVideoPlaying(false); sourceRef.current = "camera"; setSourceKind("camera");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (!alive.current || run !== generation.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      media.current = stream; photo.current = null; sourceRef.current = "camera"; setSourceKind("camera");
      if (video.current) { video.current.srcObject = stream; await video.current.play(); }
      const source = video.current, surface = canvas.current;
      if (source && surface && source.videoWidth && source.videoHeight) {
        const scale = Math.min(1, 640 / Math.max(source.videoWidth, source.videoHeight));
        surface.width = Math.round(source.videoWidth * scale); surface.height = Math.round(source.videoHeight * scale);
        surface.getContext("2d")?.drawImage(source, 0, 0, surface.width, surface.height);
        setImageSize({ width: surface.width, height: surface.height });
      }
      setLive(true); setReady(true); setStatus(phoneMode ? "Looking for a connection…" : "Point at the target, then tap Find.");
    } catch { if (run === generation.current) { media.current?.getTracks().forEach((track) => track.stop()); media.current = null; setError("Camera unavailable. Choose a photo instead."); } }
    finally { if (alive.current && run === generation.current) { busyRef.current = false; setBusy(false); } }
  }

  async function selectVideo(file: File) {
    const run = ++generation.current; busyRef.current = true; setBusy(true);
    if (ready) lostCallback.current?.();
    sentFrame.current = null; staleResultCleared.current = false;
    clearTracking(); sceneGate.current = new LiveARCapture(); setReady(false); setError(""); setVideoPlaying(false);
    media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    releaseVideo(); photo.current = null; sourceRef.current = "video"; setSourceKind("video"); setLive(false);
    try {
      const player = video.current;
      if (!player) throw new Error("Video player is unavailable.");
      const url = URL.createObjectURL(file); videoUrl.current = url;
      player.src = url; player.muted = true; player.playsInline = true; player.preload = "auto"; player.load();
      await new Promise<void>((resolve, reject) => {
        if (player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { resolve(); return; }
        const timer = window.setTimeout(() => { cleanup(); reject(new Error("This video took too long to open.")); }, 15000);
        const cleanup = () => { window.clearTimeout(timer); player.removeEventListener("loadeddata", loaded); player.removeEventListener("error", failed); };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("This video cannot play here. Try an MP4 or H.264 video.")); };
        player.addEventListener("loadeddata", loaded, { once: true });
        player.addEventListener("error", failed, { once: true });
      });
      if (!alive.current || run !== generation.current) return;
      setReady(true); setLive(true); setStatus("Playing your video. Hold on an object to scan it.");
      try { await player.play(); if (alive.current && run === generation.current) setVideoPlaying(true); }
      catch { if (alive.current && run === generation.current) setStatus("Video ready. Tap Play to start scanning."); }
    } catch (cause) {
      if (alive.current && run === generation.current) { releaseVideo(); setError(cause instanceof Error ? cause.message : "Could not open this video."); }
    } finally { if (alive.current && run === generation.current) { busyRef.current = false; setBusy(false); } }
  }

  async function replayVideo() {
    const player = video.current;
    if (sourceRef.current !== "video" || !player || !videoUrl.current) return;
    const run = ++generation.current; busyRef.current = false; setBusy(false);
    sentFrame.current = null; staleResultCleared.current = false;
    lostCallback.current?.(); clearTracking(); sceneGate.current = new LiveARCapture(); setError("");
    try { player.currentTime = 0; await player.play(); if (run === generation.current) { setVideoPlaying(true); setStatus("Replaying video. Hold on an object to scan it."); } }
    catch { if (run === generation.current) setError("Could not replay this video. Choose it again."); }
  }

  async function toggleVideo() {
    const player = video.current;
    if (sourceRef.current !== "video" || !player) return;
    if (player.ended) { await replayVideo(); return; }
    if (!player.paused) { player.pause(); setVideoPlaying(false); setStatus("Video paused. This frame can still be scanned."); return; }
    const run = generation.current;
    try { await player.play(); if (run === generation.current) { setVideoPlaying(true); setStatus("Playing your video. Hold on an object to scan it."); } }
    catch { setError("Could not play this video. Try another file."); }
  }

  useEffect(() => {
    if (!phoneMode) return;
    const timer = setTimeout(() => void startCamera(), 0);
    return () => clearTimeout(timer);
    // Camera starts once for the phone demo; ordinary AR pages keep their manual control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneMode]);

  return <div ref={container} className={`${styles.viewer} ${phoneMode ? styles.phoneDemo : ""}`}>
    <canvas ref={canvas} className={styles.media} style={{width:"100%",height:"100%",objectFit:phoneMode && sourceKind === "camera" ? "cover" : "contain"}} aria-label="Target camera, video, or photo" />
    <video ref={video} muted playsInline style={{ display: "none" }} onEnded={() => { if (sourceRef.current === "video") { setVideoPlaying(false); setStatus("Video ended. The last frame can still be scanned."); } }} />
    {!phoneMode && <header className={styles.header}><Link href="/">‹ Callback</Link><form className={styles.targetForm} onSubmit={(event) => { event.preventDefault(); void locate(); }}>
      <label htmlFor="ar-target">Find</label><input id="ar-target" className={styles.input} value={target} readOnly={!onTargetChange} onChange={(event) => onTargetChange?.(event.target.value)} maxLength={120} />
      <button className={styles.primary} disabled={!ready || busy}>Find target</button>
    </form></header>}
    {box && (generalScan || ((!scanTargetsKey || boxTarget === compactOverlay?.label) && (!scanTargetsKey || !!compactOverlay))) && <ObjectOverlay {...{ imageWidth: imageSize.width, imageHeight: imageSize.height, viewportWidth: size.width, viewportHeight: size.height, box }}
      fit={phoneMode && sourceKind === "camera" ? "cover" : "contain"} compact={phoneMode} outlineOnly={generalScan && !compactOverlay} testLabel={compactOverlay?.testLabel} label={compactOverlay?.label || boxTarget || target}
      personName={compactOverlay?.personName || connection?.personName} reason={compactOverlay?.memory || connection?.reason} onOpen={compactOverlay?.onOpen || connection?.onOpen} shopping={compactOverlay ? undefined : shopping} />}
    {phoneMode && compactOverlay && (!box || (!generalScan && boxTarget !== compactOverlay.label)) && <button className={styles.photoChip} type="button" onClick={compactOverlay.onOpen} disabled={!compactOverlay.onOpen}>
      <span className={styles.photoChipAvatar} aria-hidden="true">{compactOverlay.personName?.charAt(0) || "✦"}</span>
      <span className={styles.photoChipBody}><strong>{compactOverlay.personName || compactOverlay.label || "Object found"} {compactOverlay.testLabel && <small>{compactOverlay.testLabel}</small>}</strong><span>{compactOverlay.memory}</span></span><span aria-hidden="true">↗</span>
    </button>}
    {phoneMode && sourceKind === "video" && ready && <div className={styles.videoControls} aria-label="Video playback controls">
      <button type="button" onClick={() => void toggleVideo()}>{videoPlaying ? "Pause" : "Play"}</button>
      <button type="button" onClick={() => void replayVideo()}>Replay</button>
    </div>}
    <div className={styles.controls}>
      {!compactOverlay && <p className={`${styles.status} ${error ? styles.error : ""}`} role="status">{error || status}{testing && " · simulated camera motion"}</p>}
      <button className={styles.action} onClick={() => void startCamera()} disabled={busy}>{live ? "Restart camera" : "Camera"}</button>
      {generalScan && live && <button className={styles.action} onClick={() => { lostCallback.current?.(); sceneGate.current.retry(); }}>Check view</button>}
      <label className={styles.action}>Photo<input className={styles.fileInput} type="file" accept="image/*" aria-label="Choose target photo" disabled={busy && !phoneMode} onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
        photoCallback.current?.(file);
        const url = URL.createObjectURL(file); void setPhoto(url).finally(() => URL.revokeObjectURL(url));
      }} /></label>
      {phoneMode && <label className={styles.action}>Video<input className={styles.fileInput} type="file" accept="video/*,.mov,.mp4,.m4v,.webm" aria-label="Choose local video" disabled={busy} onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void selectVideo(file);
      }} /></label>}
      {allowMotionTest && !live && <button className={styles.action} disabled={(!box && !testing) || busy} onClick={() => { motion.current = !motion.current; setTesting(motion.current); }}>Test motion</button>}
    </div>
    {children}
  </div>;
}

export function TargetARPlayground({ initialImageUrl, allowMotionTest, demoCards = false }: { initialImageUrl?: string; allowMotionTest?: boolean; demoCards?: boolean }) {
  const [target, setTarget] = useState("coffee");
  return <TargetAR target={target} onTargetChange={setTarget} initialImageUrl={initialImageUrl} allowMotionTest={allowMotionTest}
    connection={demoCards && targetClass(target) === "cup" ? { personName: "Alex · demo", reason: "You planned to catch up over coffee this weekend. Synthetic preview context.", onOpen: () => window.alert("Demo connection. Saved scans open the real conversation.") } : undefined}
    shopping={demoCards && targetClass(target) === "cup" ? { status: "empty", title: "Coffee cups · demo search", url: "https://www.google.com/search?tbm=shop&q=coffee+cup", detail: "Preview search link. Real saved scans use ranked live listings when a provider is configured." } : undefined} />;
}
