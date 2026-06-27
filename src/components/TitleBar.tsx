import { getCurrentWindow } from "@tauri-apps/api/window";
import { Info, Minus, Moon, Square, Sun, X } from "lucide-react";

import { useLibrary } from "../store/library";
import { Mark } from "./Mark";
import styles from "./TitleBar.module.css";

const appWindow = getCurrentWindow();

/** Frameless-window titlebar: brand, contextual center label, theme + window controls. */
export function TitleBar() {
  const appTheme = useLibrary((s) => s.appTheme);
  const toggleTheme = useLibrary((s) => s.toggleTheme);
  const view = useLibrary((s) => s.view);
  const openAbout = useLibrary((s) => s.openAbout);

  const isDark = appTheme === "dark";

  return (
    <div className={styles.bar}>
      <div className={styles.brand}>
        <Mark size={22} />
        <span className={styles.wordmark}>NOVUS</span>
      </div>

      <div className={styles.drag} data-tauri-drag-region onMouseDown={(e) => onDrag(e)}>
        <span className={styles.center}>{view === "reader" ? "Reading" : "Library"}</span>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.btn}
          title="About Novus"
          onClick={() => openAbout()}
        >
          <Info size={15} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          className={styles.btn}
          title="Toggle theme"
          onClick={toggleTheme}
        >
          {isDark ? <Moon size={16} strokeWidth={1.7} /> : <Sun size={16} strokeWidth={1.7} />}
        </button>
        <div className={styles.divider} />
        <button
          type="button"
          className={styles.btn}
          title="Minimize"
          onClick={() => appWindow.minimize()}
        >
          <Minus size={13} strokeWidth={1.3} />
        </button>
        <button
          type="button"
          className={styles.btn}
          title="Maximize"
          onClick={() => appWindow.toggleMaximize()}
        >
          <Square size={12} strokeWidth={1.3} />
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.close}`}
          title="Close"
          onClick={() => appWindow.close()}
        >
          <X size={12} strokeWidth={1.3} />
        </button>
      </div>
    </div>
  );
}

function onDrag(e: React.MouseEvent) {
  // Only primary-button presses start a window drag; let double-click maximize.
  if (e.buttons === 1) {
    if (e.detail === 2) {
      appWindow.toggleMaximize();
    } else {
      appWindow.startDragging();
    }
  }
}

