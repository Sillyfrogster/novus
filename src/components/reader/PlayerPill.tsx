import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";

import type { PlayerStatus } from "../../store/tts";
import styles from "./PlayerPill.module.css";

interface PlayerPillProps {
  status: PlayerStatus;
  error: string | null;
  hidden: boolean;
  onPlayPause: () => void;
  onSkip: (delta: number) => void;
  onStop: () => void;
}

/** Floating read-aloud controls; present only while a listening run exists. */
export function PlayerPill({ status, error, hidden, onPlayPause, onSkip, onStop }: PlayerPillProps) {
  const busy = status === "preparing" || status === "stalled";
  return (
    <div className={`${styles.pill} ${hidden ? styles.hidden : ""}`} role="group" aria-label="Read aloud">
      <button
        type="button"
        className={styles.btn}
        onClick={() => onSkip(-1)}
        title="Previous sentence"
        disabled={busy}
      >
        <SkipBack size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className={`${styles.btn} ${styles.primary}`}
        onClick={onPlayPause}
        title={status === "playing" ? "Pause" : "Play"}
        disabled={busy || status === "error"}
      >
        {status === "playing" ? (
          <Pause size={16} strokeWidth={1.8} />
        ) : (
          <Play size={16} strokeWidth={1.8} />
        )}
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => onSkip(1)}
        title="Next sentence"
        disabled={busy}
      >
        <SkipForward size={14} strokeWidth={1.8} />
      </button>
      <span className={styles.state} aria-live="polite">
        {status === "error" ? (error ?? "Something went wrong") : busy ? "Preparing…" : ""}
      </span>
      <button type="button" className={styles.btn} onClick={onStop} title="Stop listening">
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
