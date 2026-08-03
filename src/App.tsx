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
import {
  cancelLibraryRestore,
  finishLibraryRestore,
  libraryRestoreStatus,
  rollbackLibraryRestore,
} from "./lib/ipc";
import { isDesktop } from "./lib/platform";
import {
  applyRestoredPreferences,
  clearPreferenceRecovery,
  preferenceRecoverySaved,
  recoverPreviousPreferences,
  restoredPreferencesApplied,
  usePreferences,
} from "./lib/preferences";
import { relaunchApp } from "./lib/updater";
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
    void loadLibraryAfterRestore(loadLibrary)
      .then((ready) => {
        setStartupState(ready ? "ready" : "blocked");
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

async function loadLibraryAfterRestore(loadLibrary: () => Promise<void>): Promise<boolean> {
  let restore;
  try {
    restore = await libraryRestoreStatus();
  } catch {
    showRestoreError(
      "Novus found an unfinished restore but could not check it. Restart Novus and try again.",
    );
    return false;
  }

  if (!restore) {
    clearPreferenceRecovery();
    await loadLibrary();
    return true;
  }

  if (restore.state === "installed") {
    if (!restoredPreferencesApplied(restore.backupCreatedAt)) {
      try {
        applyRestoredPreferences(restore.backupCreatedAt, restore.preferences);
        window.location.reload();
      } catch {
        tryRecoverPreviousPreferences();
        await beginRestoreRollback(
          loadLibrary,
          "Novus could not apply the saved preferences. Restart Novus to return to your previous library.",
        );
      }
      return false;
    }

    await loadLibrary();
    if (useLibrary.getState().error) {
      const preferences = tryRecoverPreviousPreferences();
      await beginRestoreRollback(
        loadLibrary,
        preferences === "failed"
          ? "Restart Novus to return to your previous library. Novus will also try to restore its previous preferences."
          : "Restart Novus to return to your previous library.",
      );
      return false;
    }

    try {
      await finishLibraryRestore();
      clearPreferenceRecovery();
    } catch {
      showRestoreError("Your library is restored, but Novus could not finish cleaning up.");
      return false;
    }
    useLibrary.getState().clearAppNotice();
    return true;
  }

  if (restore.state === "failed") {
    const preferencesWereApplied = restoredPreferencesApplied(restore.backupCreatedAt);
    const preferences = tryRecoverPreviousPreferences();
    let cancelled = true;
    try {
      await cancelLibraryRestore();
      if (preferences !== "failed") clearPreferenceRecovery();
    } catch {
      cancelled = false;
    }
    await loadLibrary();
    showRestoreError(
      preferencesWereApplied && preferences !== "restored"
        ? "Novus kept your current library, but could not restore its previous preferences."
        : cancelled
          ? "Novus kept your current library because the restored copy could not be verified."
          : "Novus kept your current library, but could not finish cleaning up the failed restore.",
    );
    return cancelled;
  }

  if (restore.state === "prepared") {
    let cancelled = true;
    try {
      await cancelLibraryRestore();
    } catch {
      cancelled = false;
    }
    if (!cancelled) {
      showRestoreError(
        "Novus could not cancel an unfinished restore. Restart Novus and try again.",
      );
      return false;
    }
    clearPreferenceRecovery();
    await loadLibrary();
    return true;
  }

  showRestoreError("Restart Novus to finish restoring your library.");
  return false;
}

function showRestoreError(error: string): void {
  useLibrary.getState().showAppNotice({
    text: error,
    tone: "error",
    persistent: true,
  });
}

async function beginRestoreRollback(
  loadLibrary: () => Promise<void>,
  relaunchMessage: string,
): Promise<void> {
  try {
    await rollbackLibraryRestore();
  } catch {
    await loadLibrary();
    showRestoreError(
      "Novus could not return to your previous library. Restart Novus and try again.",
    );
    return;
  }
  try {
    await relaunchApp();
  } catch {
    await loadLibrary();
    showRestoreError(relaunchMessage);
  }
}

type PreferenceRecovery = "missing" | "restored" | "failed";

function tryRecoverPreviousPreferences(): PreferenceRecovery {
  if (!preferenceRecoverySaved()) return "missing";
  try {
    recoverPreviousPreferences();
    return "restored";
  } catch {
    return "failed";
  }
}
