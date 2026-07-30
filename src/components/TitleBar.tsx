import { getCurrentWindow } from "@tauri-apps/api/window";
import { Info, Minus, Moon, Square, Sun, X } from "lucide-react";

import { useLibrary } from "../store/library";
import { Mark } from "./Mark";
import styles from "./TitleBar.module.css";

const appWindow = getCurrentWindow();
type ResizeDirection = Parameters<typeof appWindow.startResizeDragging>[0];

interface TitleBarProps {
  operationsEnabled?: boolean;
}

interface ResizeHandleProps {
  className: string;
  direction: ResizeDirection;
}

function ResizeHandle({ className, direction }: ResizeHandleProps) {
  return (
    <div
      aria-hidden="true"
      className={`${styles.resizeHandle} ${className}`}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        void appWindow.startResizeDragging(direction);
      }}
    />
  );
}

export function TitleBar({ operationsEnabled = true }: TitleBarProps) {
  const appTheme = useLibrary((s) => s.appTheme);
  const toggleTheme = useLibrary((s) => s.toggleTheme);
  const view = useLibrary((s) => s.view);
  const openAbout = useLibrary((s) => s.openAbout);

  const isDark = appTheme === "dark";

  return (
    <>
      <ResizeHandle className={styles.north} direction="North" />
      <ResizeHandle className={styles.east} direction="East" />
      <ResizeHandle className={styles.south} direction="South" />
      <ResizeHandle className={styles.west} direction="West" />
      <ResizeHandle className={styles.northEast} direction="NorthEast" />
      <ResizeHandle className={styles.northWest} direction="NorthWest" />
      <ResizeHandle className={styles.southEast} direction="SouthEast" />
      <ResizeHandle className={styles.southWest} direction="SouthWest" />

      <div className={styles.bar}>
        <div className={styles.brand}>
          <Mark size={22} />
          <span className={styles.wordmark}>NOVUS</span>
        </div>

        <div className={styles.drag} data-tauri-drag-region>
          <span className={styles.center} data-tauri-drag-region>
            {view === "reader" ? "Reading" : "Library"}
          </span>
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.btn}
            title={operationsEnabled ? "About Novus" : "Available after library recovery"}
            onClick={() => openAbout()}
            disabled={!operationsEnabled}
          >
            <Info size={15} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className={styles.btn}
            title={operationsEnabled ? "Toggle theme" : "Available after library recovery"}
            onClick={toggleTheme}
            disabled={!operationsEnabled}
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
    </>
  );
}
