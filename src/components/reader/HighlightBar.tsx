import { useEffect, useRef, useState } from "react";

import { HIGHLIGHT_COLOR_KEYS, type HighlightColor } from "../../lib/highlightColors";
import type { HighlightColorKey } from "../../lib/types";
import { placeHighlightBar } from "./highlightBarPosition";
import styles from "./HighlightBar.module.css";

interface HighlightBarProps {
  rect: { top: number; bottom: number; left: number; right: number };
  colors: Record<HighlightColorKey, HighlightColor>;
  onPick: (color: HighlightColorKey) => void;
  onDismiss: () => void;
}

export function HighlightBar({ rect, colors, onPick, onDismiss }: HighlightBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    setPos(placeHighlightBar(rect, { width: window.innerWidth, height: window.innerHeight }));
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
