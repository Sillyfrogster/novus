import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, FileDown, ImageDown, Info, Trash2 } from "lucide-react";

import styles from "./HighlightContextMenu.module.css";

interface HighlightContextMenuProps {
  x: number;
  y: number;
  onDetails: () => void;
  onCopy: () => void;
  onShareImage: () => void;
  onExportMarkdown: () => void;
  onExportObsidian: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const MENU_W = 226;

export function HighlightContextMenu({
  x,
  y,
  onDetails,
  onCopy,
  onShareImage,
  onExportMarkdown,
  onExportObsidian,
  onDelete,
  onClose,
}: HighlightContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setPos({
      left: Math.min(x, window.innerWidth - MENU_W - 12),
      top: Math.min(y, window.innerHeight - h - 12),
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <>
      <div className={styles.scrim} onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div ref={ref} className={styles.menu} style={{ left: pos.left, top: pos.top, width: MENU_W }} role="menu">
        <button type="button" className={styles.item} onClick={run(onDetails)} role="menuitem">
          <Info size={15} strokeWidth={1.7} />
          Details
        </button>
        <button type="button" className={styles.item} onClick={run(onCopy)} role="menuitem">
          <Copy size={15} strokeWidth={1.7} />
          Copy text
        </button>
        <button type="button" className={styles.item} onClick={run(onShareImage)} role="menuitem">
          <ImageDown size={15} strokeWidth={1.7} />
          Save image…
        </button>
        <button type="button" className={styles.item} onClick={run(onExportMarkdown)} role="menuitem">
          <FileDown size={15} strokeWidth={1.7} />
          Export Markdown…
        </button>
        <button type="button" className={styles.item} onClick={run(onExportObsidian)} role="menuitem">
          <FileDown size={15} strokeWidth={1.7} />
          Export for Obsidian…
        </button>
        <div className={styles.divider} />
        <button
          type="button"
          className={`${styles.item} ${styles.danger}`}
          onClick={run(onDelete)}
          role="menuitem"
        >
          <Trash2 size={15} strokeWidth={1.7} />
          Delete
        </button>
      </div>
    </>
  );
}
