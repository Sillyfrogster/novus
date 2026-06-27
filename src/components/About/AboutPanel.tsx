import { Check, Download, RotateCw, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { CHANGELOG, compareVersions, type ChangeKind } from "../../lib/changelog";
import { useAppVersion } from "../../lib/version";
import { useLibrary } from "../../store/library";
import { useUpdate } from "../../store/update";
import { Mark } from "../Mark";
import styles from "./AboutPanel.module.css";

const KIND_LABEL: Record<ChangeKind, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
};

export function AboutPanel() {
  const close = useLibrary((s) => s.closeAbout);
  const highlightSince = useLibrary((s) => s.aboutHighlightSince);
  const version = useAppVersion();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <>
      <div className={styles.backdrop} onClick={close} />
      <aside
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="About Novus"
        tabIndex={-1}
      >
        <header className={styles.head}>
          <div className={styles.brand}>
            <Mark size={26} />
            <div>
              <div className={styles.wordmark}>NOVUS</div>
              <div className={styles.version}>{version ? `Version ${version}` : " "}</div>
            </div>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={close}
            title="Close"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <p className={styles.tagline}>
          A quiet, careful home for the books you keep. Free to use, supported by readers who
          choose to give.
        </p>

        <UpdateRow />

        <div className={styles.divider} />

        <h2 className={styles.sectionTitle}>Release history</h2>
        <ol className={styles.releases}>
          {CHANGELOG.map((release) => {
            const isNew = highlightSince
              ? compareVersions(release.version, highlightSince) > 0
              : false;
            return (
              <li
                key={release.version}
                className={`${styles.release} ${isNew ? styles.releaseNew : ""}`}
              >
                <div className={styles.releaseHead}>
                  <span className={styles.releaseVersion}>{release.version}</span>
                  <span className={styles.releaseDate}>{formatDate(release.date)}</span>
                  {isNew && <span className={styles.newTag}>New</span>}
                </div>
                {release.title && <div className={styles.releaseTitle}>{release.title}</div>}
                <ul className={styles.notes}>
                  {release.notes.map((note) => (
                    <li key={`${note.kind}-${note.text}`} className={styles.note}>
                      <span className={styles.noteKind} data-kind={note.kind}>
                        {KIND_LABEL[note.kind]}
                      </span>
                      <span className={styles.noteText}>{note.text}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </aside>
    </>
  );
}

function UpdateRow() {
  const status = useUpdate((s) => s.status);
  const available = useUpdate((s) => s.available);
  const progress = useUpdate((s) => s.progress);
  const error = useUpdate((s) => s.error);
  const check = useUpdate((s) => s.check);
  const install = useUpdate((s) => s.install);
  const restart = useUpdate((s) => s.restart);

  const pct = Math.round(progress * 100);

  return (
    <div className={styles.update}>
      <div className={styles.updateText}>
        {status === "available" && available
          ? `Version ${available.version} is available.`
          : status === "downloading"
            ? `Downloading update… ${pct}%`
            : status === "ready"
              ? "Update installed — restart to finish."
              : status === "checking"
                ? "Checking for updates…"
                : status === "upToDate"
                  ? "You're on the latest version."
                  : status === "error"
                    ? "Couldn't check for updates right now."
                    : "Keep Novus up to date."}
      </div>

      {status === "downloading" && (
        <div className={styles.progressTrack} aria-hidden="true">
          <div className={styles.progressFill} style={{ transform: `scaleX(${progress})` }} />
        </div>
      )}

      {status === "error" && error && <div className={styles.updateError}>{error}</div>}

      <div className={styles.updateActions}>
        {status === "available" ? (
          <button type="button" className={styles.primaryBtn} onClick={install}>
            <Download size={14} strokeWidth={1.7} />
            Download &amp; install
          </button>
        ) : status === "ready" ? (
          <button type="button" className={styles.primaryBtn} onClick={restart}>
            <RotateCw size={14} strokeWidth={1.7} />
            Restart now
          </button>
        ) : status === "downloading" ? null : (
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => check(false)}
            disabled={status === "checking"}
          >
            {status === "upToDate" ? (
              <>
                <Check size={14} strokeWidth={1.7} />
                Check again
              </>
            ) : (
              "Check for updates"
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}
