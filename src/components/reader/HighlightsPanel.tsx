import { useState } from "react";
import { RotateCcw, Settings2, X } from "lucide-react";

import {
  HIGHLIGHT_COLOR_KEYS,
  recolorHighlight,
  renameHighlightColor,
  resetHighlightColor,
  usePreferences,
} from "../../lib/preferences";
import { useDialog } from "../../lib/useDialog";
import { useHighlightGroups, useHighlights } from "../../store/highlights";
import styles from "./HighlightsPanel.module.css";

interface HighlightsPanelProps {
  onJump: (cfi: string) => void;
  onClose: () => void;
}

export function HighlightsPanel({ onJump, onClose }: HighlightsPanelProps) {
  const highlights = useHighlights((s) => s.highlights);
  const groups = useHighlightGroups();
  const status = useHighlights((s) => s.status);
  const colors = usePreferences((s) => s.highlightColors);
  const [managing, setManaging] = useState(false);
  const dialogRef = useDialog();

  return (
    <dialog
      ref={dialogRef}
      className={styles.panel}
      aria-labelledby="reader-highlights-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.head}>
        <div className={styles.headCopy}>
          <h2 id="reader-highlights-title" className={styles.title}>
            Highlights
          </h2>
          <span className={styles.count}>
            {highlights.length} saved {highlights.length === 1 ? "passage" : "passages"}
          </span>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={`${styles.iconBtn} ${managing ? styles.iconBtnOn : ""}`}
            onClick={() => setManaging((v) => !v)}
            title={managing ? "Hide color settings" : "Manage colors"}
            aria-label={managing ? "Hide color settings" : "Manage colors"}
            aria-pressed={managing}
          >
            <Settings2 size={15} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            title="Close"
            aria-label="Close highlights"
          >
            <X size={14} strokeWidth={1.4} />
          </button>
        </div>
      </div>

      {managing && (
        <div className={styles.manage}>
          <div className={styles.manageHead}>
            <span className={styles.manageTitle}>Color palette</span>
            <span className={styles.manageHint}>Rename or recolor each highlight style.</span>
          </div>
          {HIGHLIGHT_COLOR_KEYS.map((key) => (
            <div key={key} className={styles.manageRow}>
              <label className={styles.swatchLabel} title="Change color">
                <span className={styles.visuallyHidden}>
                  Color for {colors[key].label}
                </span>
                <span className={styles.swatch} style={{ background: colors[key].color }} />
                <input
                  type="color"
                  className={styles.colorInput}
                  value={colors[key].color}
                  aria-label={`Color for ${colors[key].label}`}
                  onChange={(e) => recolorHighlight(key, e.target.value)}
                />
              </label>
              <input
                className={styles.nameInput}
                value={colors[key].label}
                onChange={(e) => renameHighlightColor(key, e.target.value)}
                aria-label={`Name for ${key}`}
              />
              <button
                type="button"
                className={styles.resetBtn}
                onClick={() => resetHighlightColor(key)}
                title="Reset to default"
                aria-label={`Reset ${key} to default`}
              >
                <RotateCcw size={13} strokeWidth={1.7} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.list} aria-busy={status === "loading"}>
        {status === "loading" && highlights.length === 0 ? (
          <div className={styles.empty} role="status">
            <p className={styles.emptyLead}>Loading highlights…</p>
          </div>
        ) : status === "error" && highlights.length === 0 ? (
          <div className={styles.empty} role="alert">
            <p className={styles.emptyLead}>Novus could not load these highlights.</p>
            <p className={styles.emptyHint}>Close this panel and try again.</p>
          </div>
        ) : highlights.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyLead}>No highlights yet.</p>
            <p className={styles.emptyHint}>
              Select any passage as you read, then choose a color to keep it.
            </p>
          </div>
        ) : (
          groups.map((group, gi) => (
            <section key={`${group.label}-${gi}`} className={styles.group}>
              <div className={styles.chapter}>{group.label}</div>
              {group.items.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={styles.item}
                  onClick={() => onJump(h.cfi)}
                >
                  <span
                    className={styles.tick}
                    style={{ background: colors[h.color]?.color ?? colors.slate.color }}
                    aria-hidden="true"
                  />
                  <span className={styles.passage}>
                    {h.text}
                    {h.note ? <span className={styles.note}>{h.note}</span> : null}
                  </span>
                </button>
              ))}
            </section>
          ))
        )}
      </div>
    </dialog>
  );
}
