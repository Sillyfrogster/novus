import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";

import { AboutPanel } from "./components/About/AboutPanel";
import { Reader } from "./components/reader/Reader";
import { TitleBar } from "./components/TitleBar";
import { Toast } from "./components/Toast";
import { UpdateBanner } from "./components/UpdateBanner";
import { compareVersions } from "./lib/changelog";
import { useZoomGuard } from "./lib/useZoomGuard";
import { appVersion } from "./lib/version";
import { useLibrary } from "./store/library";
import { useUpdate } from "./store/update";
import { Library } from "./views/Library/Library";
import styles from "./App.module.css";

/** Tracks the newest version */
const LAST_SEEN_KEY = "novus.lastSeenVersion";

export default function App() {
  const appTheme = useLibrary((s) => s.appTheme);
  const view = useLibrary((s) => s.view);
  const aboutOpen = useLibrary((s) => s.aboutOpen);
  const loadLibrary = useLibrary((s) => s.loadLibrary);
  const importPaths = useLibrary((s) => s.importPaths);
  const [dropping, setDropping] = useState(false);

  useZoomGuard();

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  // On launch: quietly check for updates (offline failures stay silent).
  useEffect(() => {
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
  }, []);

  // Native file drag-and-drop
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const { payload } = event;
      if (payload.type === "over") {
        setDropping(true);
      } else if (payload.type === "drop") {
        setDropping(false);
        const epubs = payload.paths.filter((p) => p.toLowerCase().endsWith(".epub"));
        if (epubs.length > 0) importPaths(epubs);
      } else {
        setDropping(false);
      }
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, [importPaths]);

  return (
    <div className={styles.app} data-app-theme={appTheme}>
      <div className="nv-grain" aria-hidden="true" />
      <TitleBar />
      <div className={styles.body}>
        {view === "reader" ? <Reader /> : <Library dropping={dropping} />}
      </div>
      <UpdateBanner />
      {aboutOpen && <AboutPanel />}
      <Toast />
    </div>
  );
}
