import { ArrowUpCircle, X } from "lucide-react";

import { useLibrary } from "../store/library";
import { useUpdate } from "../store/update";
import styles from "./UpdateBanner.module.css";

/**
 * update prompt
 */
export function UpdateBanner() {
  const status = useUpdate((s) => s.status);
  const available = useUpdate((s) => s.available);
  const dismissed = useUpdate((s) => s.bannerDismissed);
  const dismiss = useUpdate((s) => s.dismissBanner);
  const openAbout = useLibrary((s) => s.openAbout);

  if (status !== "available" || !available || dismissed) return null;

  return (
    <div className={styles.banner} role="status">
      <button type="button" className={styles.main} onClick={() => openAbout()}>
        <ArrowUpCircle className={styles.icon} size={16} strokeWidth={1.7} aria-hidden="true" />
        <span className={styles.message}>
          Novus {available.version} is ready — <span className={styles.cta}>see what's new</span>
        </span>
      </button>
      <button type="button" className={styles.close} onClick={dismiss} title="Dismiss" aria-label="Dismiss">
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}
