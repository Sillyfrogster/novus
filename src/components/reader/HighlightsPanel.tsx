import { useMemo, useState } from "react";
import { RotateCcw, Settings2, X } from "lucide-react";

import { HIGHLIGHT_COLOR_KEYS } from "../../lib/highlightColors";
import type { Highlight } from "../../lib/types";
import { useHighlights } from "../../store/highlights";
import styles from "./HighlightsPanel.module.css";

interface HighlightsPanelProps {
  onJump: (cfi: string) => void;
  onClose: () => void;
}

interface ChapterGroup {
  label: string;
  items: Highlight[];
}

/** Group highlights into runs by the chapter */
function groupByChapter(highlights: Highlight[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  for (const h of highlights) {
    const label = h.chapterLabel?.trim() || "Unlabeled";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(h);
    else groups.push({ label, items: [h] });
  }
  return groups;
}

export function HighlightsPanel({ onJump, onClose }: HighlightsPanelProps) {
  const highlights = useHighlights((s) => s.highlights);
  const colors = useHighlights((s) => s.colors);
  const renameColor = useHighlights((s) => s.renameColor);
  const recolor = useHighlights((s) => s.recolor);
  const resetColorSlot = useHighlights((s) => s.resetColorSlot);
  const [managing, setManaging] = useState(false);

  const groups = useMemo(() => groupByChapter(highlights), [highlights]);

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.panel} role="dialog" aria-label="Highlights">
        <div className={styles.head}>
          Highlights
          <div className={styles.headActions}>
            <button
              type="button"
              className={`${styles.iconBtn} ${managing ? styles.iconBtnOn : ""}`}
              onClick={() => setManaging((v) => !v)}
              title="Manage colors"
              aria-label="Manage colors"
              aria-pressed={managing}
            >
              <Settings2 size={15} strokeWidth={1.7} />
            </button>
            <button type="button" className={styles.iconBtn} onClick={onClose} title="Close">
              <X size={14} strokeWidth={1.4} />
            </button>
          </div>
        </div>

        {managing && (
          <div className={styles.manage}>
            {HIGHLIGHT_COLOR_KEYS.map((key) => (
              <div key={key} className={styles.manageRow}>
                <label className={styles.swatchLabel} title="Change color">
                  <span className={styles.swatch} style={{ background: colors[key].color }} />
                  <input
                    type="color"
                    className={styles.colorInput}
                    value={colors[key].color}
                    onChange={(e) => recolor(key, e.target.value)}
                  />
                </label>
                <input
                  className={styles.nameInput}
                  value={colors[key].label}
                  onChange={(e) => renameColor(key, e.target.value)}
                  aria-label={`Name for ${key}`}
                />
                <button
                  type="button"
                  className={styles.resetBtn}
                  onClick={() => resetColorSlot(key)}
                  title="Reset to default"
                  aria-label={`Reset ${key} to default`}
                >
                  <RotateCcw size={13} strokeWidth={1.7} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.list}>
          {highlights.length === 0 ? (
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
      </div>
    </>
  );
}
