import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";

import { AboutPanel } from "./components/About/AboutPanel";
import { Reader } from "./components/reader/Reader";
import { TitleBar } from "./components/TitleBar";
import { Toast } from "./components/Toast";
import { UpdateBanner } from "./components/UpdateBanner";
import { refreshCoverUrls } from "./lib/assets";
import { compareVersions } from "./lib/changelog";
import { blockNativeContextMenu } from "./lib/contextMenu";
import { libraryCopy } from "./lib/libraryCopy";
import { isDesktop } from "./lib/platform";
import { usePreferences } from "./lib/preferences";
import { useZoomGuard } from "./lib/useZoomGuard";
import { appVersion } from "./lib/version";
import { useLibrary } from "./store/library";
import { useUpdate } from "./store/update";
import { Insights } from "./views/Insights/Insights";
import { Library } from "./views/Library/Library";
import styles from "./App.module.css";

const LAST_SEEN_KEY = "novus.lastSeenVersion";
type StartupState = "checking" | "ready" | "blocked";

export default function App() {
  const appTheme = usePreferences((s) => s.appTheme);
  const view = useLibrary((s) => s.view);
  const aboutOpen = useLibrary((s) => s.aboutOpen);
  const loadLibrary = useLibrary((s) => s.loadLibrary);
  const importPaths = useLibrary((s) => s.importPaths);
  const [dropping, setDropping] = useState(false);
  const [, redrawCovers] = useState(0);
  const [startupState, setStartupState] = useState<StartupState>("checking");
  const startupStarted = useRef(false);

  useZoomGuard();

  useEffect(() => blockNativeContextMenu(window), []);

  useEffect(() => {
    const unlisten = getCurrentWebview().listen<number>("covers-optimized", () => {
      refreshCoverUrls();
      redrawCovers((revision) => revision + 1);
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  useEffect(() => {
    if (startupStarted.current) return;
    startupStarted.current = true;
    void libraryCopy
      .resume(async () => {
        await loadLibrary();
        return !useLibrary.getState().error;
      })
      .then((result) => {
        if (result.error) showRestoreError(result.error);
        setStartupState(result.ready ? "ready" : "blocked");
      })
      .catch(() => {
        showRestoreError(
          "Novus could not finish opening your library. Restart Novus and try again.",
        );
        setStartupState("blocked");
      });
  }, [loadLibrary]);

  useEffect(() => {
    if (!isDesktop || startupState !== "ready") return;
    useUpdate.getState().check(true);

    let cancelled = false;
    appVersion().then((current) => {
      if (cancelled || !current) return;
      const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
      if (lastSeen === null) {
        localStorage.setItem(LAST_SEEN_KEY, current);
        return;
      }
      if (compareVersions(current, lastSeen) > 0) {
        useLibrary.getState().openAbout(lastSeen);
        localStorage.setItem(LAST_SEEN_KEY, current);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [startupState]);

  useEffect(() => {
    if (!isDesktop) return;
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const { payload } = event;
      if (startupState !== "ready") {
        setDropping(false);
        return;
      }
      if (payload.type === "over") {
        setDropping(true);
      } else if (payload.type === "drop") {
        setDropping(false);
        const books = payload.paths.filter((p) => /\.epub$/i.test(p));
        if (books.length > 0) importPaths(books);
      } else {
        setDropping(false);
      }
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, [importPaths, startupState]);

  return (
    <div className={styles.app} data-app-theme={appTheme}>
      <div className="nv-grain" aria-hidden="true" />
      <TitleBar operationsEnabled={startupState === "ready"} />
      <div className={styles.body}>
        {startupState !== "ready" ? (
          <div className={styles.startupState} role="status" aria-live="polite">
            {startupState === "checking"
              ? "Opening your library…"
              : "Restart Novus to finish recovering your library."}
          </div>
        ) : (
          <>
            <div
              className={`${styles.libraryView} ${view === "library" ? "" : styles.libraryViewHidden}`}
              inert={view !== "library"}
              aria-hidden={view !== "library"}
            >
              <Library dropping={dropping} />
            </div>
            {view === "reader" && <Reader />}
            {view === "insights" && <Insights />}
          </>
        )}
      </div>
      {isDesktop && startupState === "ready" && <UpdateBanner />}
      {startupState === "ready" && aboutOpen && <AboutPanel />}
      <Toast />
    </div>
  );
}

function showRestoreError(error: string): void {
  useLibrary.getState().showAppNotice({
    text: error,
    tone: "error",
    persistent: true,
  });
}
