import { useEffect, useRef, useState } from "react";

import { HIGHLIGHT_COLOR_KEYS, type HighlightColor } from "../../lib/highlightColors";
import type { HighlightColorKey } from "../../lib/types";
import styles from "./HighlightBar.module.css";

interface HighlightBarProps {
  rect: { top: number; bottom: number; left: number; right: number };
  colors: Record<HighlightColorKey, HighlightColor>;
  onPick: (color: HighlightColorKey) => void;
  onDismiss: () => void;
}

const BAR_WIDTH = 184;
const GAP = 12;

/** surfaces by the selection */
export function HighlightBar({ rect, colors, onPick, onDismiss }: HighlightBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);

  useEffect(() => {
    const midX = (rect.left + rect.right) / 2;
    const left = Math.max(GAP, Math.min(window.innerWidth - BAR_WIDTH - GAP, midX - BAR_WIDTH / 2));
    const below = rect.top < 96;
    const top = below ? rect.bottom + GAP : rect.top - GAP;
    setPos({ top, left, below });
  }, [rect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (!pos) return null;

  return (
    <div
      ref={ref}
      className={styles.bar}
      role="toolbar"
      aria-label="Highlight selection"
      style={{
        top: pos.top,
        left: pos.left,
        transform: pos.below ? "none" : "translateY(-100%)",
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {HIGHLIGHT_COLOR_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className={styles.dot}
          style={{ ["--dot" as string]: colors[key].color }}
          title={`Highlight · ${colors[key].label}`}
          aria-label={`Highlight in ${colors[key].label}`}
          onClick={() => onPick(key)}
        />
      ))}
    </div>
  );
}
