import { useEffect, useState } from "react";
import { Copy, FileDown, Image, ImageDown, Info, Trash2 } from "lucide-react";

import { useDialog } from "../../lib/useDialog";
import styles from "./HighlightContextMenu.module.css";

interface HighlightContextMenuProps {
  x: number;
  y: number;
  onDetails: () => void;
  onCopy: () => void;
  onCopyImage: () => void;
  onSaveImage: () => void;
  onExportMarkdown: () => void;
  onExportObsidian: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const MENU_W = 226;
const VIEWPORT_GAP = 12;

export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  return {
    left: Math.max(
      VIEWPORT_GAP,
      Math.min(x, viewportWidth - menuWidth - VIEWPORT_GAP),
    ),
    top: Math.max(
      VIEWPORT_GAP,
      Math.min(y, viewportHeight - menuHeight - VIEWPORT_GAP),
    ),
  };
}

export function HighlightContextMenu({
  x,
  y,
  onDetails,
  onCopy,
  onCopyImage,
  onSaveImage,
  onExportMarkdown,
  onExportObsidian,
  onDelete,
  onClose,
}: HighlightContextMenuProps) {
  const ref = useDialog();
  const menuWidth = Math.min(MENU_W, window.innerWidth - VIEWPORT_GAP * 2);
  const [pos, setPos] = useState(() =>
    clampMenuPosition(x, y, menuWidth, 0, window.innerWidth, window.innerHeight),
  );

  useEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setPos(
      clampMenuPosition(x, y, menuWidth, h, window.innerWidth, window.innerHeight),
    );
  }, [menuWidth, ref, x, y]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className={styles.menu}
      style={{ left: pos.left, top: pos.top, width: menuWidth }}
      role="menu"
      aria-label="Highlight actions"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom;
        if (outside) onClose();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
        ];
        if (items.length === 0) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? (current + 1) % items.length
                : (current - 1 + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      <button
        type="button"
        className={styles.item}
        onClick={run(onDetails)}
        role="menuitem"
      >
        <Info size={15} strokeWidth={1.7} />
        Details
      </button>
      <button type="button" className={styles.item} onClick={run(onCopy)} role="menuitem">
        <Copy size={15} strokeWidth={1.7} />
        Copy text
      </button>
      <button
        type="button"
        className={styles.item}
        onClick={run(onCopyImage)}
        role="menuitem"
      >
        <Image size={15} strokeWidth={1.7} />
        Copy as image
      </button>
      <button
        type="button"
        className={styles.item}
        onClick={run(onSaveImage)}
        role="menuitem"
      >
        <ImageDown size={15} strokeWidth={1.7} />
        Save image…
      </button>
      <div className={styles.divider} role="separator" />
      <button
        type="button"
        className={styles.item}
        onClick={run(onExportMarkdown)}
        role="menuitem"
      >
        <FileDown size={15} strokeWidth={1.7} />
        Export Markdown…
      </button>
      <button
        type="button"
        className={styles.item}
        onClick={run(onExportObsidian)}
        role="menuitem"
      >
        <FileDown size={15} strokeWidth={1.7} />
        Export for Obsidian…
      </button>
      <div className={styles.divider} role="separator" />
      <button
        type="button"
        className={`${styles.item} ${styles.danger}`}
        onClick={run(onDelete)}
        role="menuitem"
      >
        <Trash2 size={15} strokeWidth={1.7} />
        Delete
      </button>
    </dialog>
  );
}
