import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

import { useLibrary } from "../store/library";

/** Keys that trigger browser zoom alongside Ctrl/Cmd. */
const ZOOM_KEYS = new Set(["+", "-", "=", "0"]);

/** Suppress zooming on anything other than the reader */
export function useZoomGuard(): void {
  const view = useLibrary((s) => s.view);

  useEffect(() => {
    invoke("set_zoom_locked", { locked: view !== "reader" }).catch(() => {});
  }, [view]);

  useEffect(() => {
    const inReader = () => useLibrary.getState().view === "reader";

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey && !inReader()) e.preventDefault();
    };
    // Safari/WebKit pinch magnification arrives as gesture events.
    const onGesture = (e: Event) => {
      if (!inReader()) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ZOOM_KEYS.has(e.key) && !inReader()) {
        e.preventDefault();
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("gesturestart", onGesture, { passive: false });
    window.addEventListener("gesturechange", onGesture, { passive: false });
    window.addEventListener("gestureend", onGesture, { passive: false });
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("gesturestart", onGesture);
      window.removeEventListener("gesturechange", onGesture);
      window.removeEventListener("gestureend", onGesture);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
