import { useEffect } from "react";
import { CircleAlert, X } from "lucide-react";

import { useLibrary } from "../store/library";
import styles from "./Toast.module.css";

/** Auto-dismiss delay */
const DISMISS_MS = 6000;

export function Toast() {
  const error = useLibrary((s) => s.error);
  const clearError = useLibrary((s) => s.clearError);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(clearError, DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [error, clearError]);

  if (!error) return null;

  return (
    <div className={styles.toast} role="alert">
      <CircleAlert className={styles.icon} size={16} strokeWidth={1.8} aria-hidden="true" />
      <span className={styles.message}>{error}</span>
      <button type="button" className={styles.close} onClick={clearError} title="Dismiss">
        <X size={13} strokeWidth={1.4} />
      </button>
    </div>
  );
}
