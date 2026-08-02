import { useEffect, useRef } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";

import { useLibrary } from "../store/library";
import styles from "./Toast.module.css";

const DISMISS_MS = 6000;

export function Toast() {
  const toastRef = useRef<HTMLDivElement>(null);
  const routineError = useLibrary((s) => s.error);
  const appNotice = useLibrary((s) => s.appNotice);
  const clearError = useLibrary((s) => s.clearError);
  const clearAppNotice = useLibrary((s) => s.clearAppNotice);
  const message = appNotice?.text ?? routineError;
  const clear = appNotice ? clearAppNotice : clearError;

  useEffect(() => {
    if (!message || appNotice?.persistent) return;
    const t = window.setTimeout(clear, DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [message, appNotice, clear]);

  useEffect(() => {
    const toast = toastRef.current;
    if (!toast || !("showPopover" in toast)) return;
    try {
      toast.showPopover();
    } catch {
      toast.removeAttribute("popover");
    }
    return () => {
      try {
        toast.hidePopover();
      } catch {}
    };
  }, [message]);

  if (!message) return null;
  const tone = appNotice?.tone ?? "error";

  return (
    <div
      ref={toastRef}
      className={styles.toast}
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
      popover="manual"
    >
      {tone === "success" ? (
        <CircleCheck className={styles.icon} size={16} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <CircleAlert className={styles.icon} size={16} strokeWidth={1.8} aria-hidden="true" />
      )}
      <span className={styles.message}>{message}</span>
      <button
        type="button"
        className={styles.close}
        onClick={clear}
        title="Dismiss"
        aria-label="Dismiss"
      >
        <X size={13} strokeWidth={1.4} />
      </button>
    </div>
  );
}
