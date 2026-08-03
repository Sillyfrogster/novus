import { invoke } from "@tauri-apps/api/core";

import {
  applyRestoredPreferences,
  clearPreferenceRecovery,
  currentPreferences,
  preferenceRecoverySaved,
  recoverPreviousPreferences,
  restoredPreferencesApplied,
  type PreferencesSnapshot,
} from "./preferences";
import { relaunchApp } from "./updater";

export interface BackupSummary {
  createdAt: number;
  bookCount: number;
  fileCount: number;
  byteCount: number;
}

export interface RestoreSummary {
  backupCreatedAt: number;
  bookCount: number;
  fileCount: number;
}

interface RestoreStatus extends RestoreSummary {
  state: "prepared" | "install" | "installing" | "installed" | "rollingBack" | "failed";
  preferences: PreferencesSnapshot;
  error: string | null;
}

interface LibraryCopyBackend {
  save: (path: string, preferences: PreferencesSnapshot) => Promise<BackupSummary>;
  prepare: (path: string) => Promise<RestoreSummary>;
  commit: () => Promise<void>;
  cancel: () => Promise<void>;
  status: () => Promise<RestoreStatus | null>;
  finish: () => Promise<void>;
  rollback: () => Promise<void>;
  relaunch: () => Promise<void>;
}

export interface LibraryStartup {
  ready: boolean;
  error?: string;
}

type OpenLibrary = () => Promise<boolean>;
type PreferenceRecovery = "missing" | "restored" | "failed";

const tauriBackend: LibraryCopyBackend = {
  save: (path, preferences) =>
    invoke<BackupSummary>("create_library_backup", { path, preferences }),
  prepare: (path) => invoke<RestoreSummary>("prepare_library_restore", { path }),
  commit: () => invoke<void>("commit_library_restore"),
  cancel: () => invoke<void>("cancel_library_restore"),
  status: () => invoke<RestoreStatus | null>("library_restore_status"),
  finish: () => invoke<void>("finish_library_restore"),
  rollback: () => invoke<void>("rollback_library_restore"),
  relaunch: relaunchApp,
};

function recoverPreferences(): PreferenceRecovery {
  if (!preferenceRecoverySaved()) return "missing";
  try {
    return recoverPreviousPreferences() ? "restored" : "missing";
  } catch {
    return "failed";
  }
}

async function opens(openLibrary: OpenLibrary): Promise<boolean> {
  try {
    return await openLibrary();
  } catch {
    return false;
  }
}

export function createLibraryCopy(
  backend: LibraryCopyBackend,
  reload: () => void = () => window.location.reload(),
) {
  const blocked = (error?: string): LibraryStartup => ({ ready: false, error });

  const rollback = async (
    openLibrary: OpenLibrary,
    relaunchError: string,
  ): Promise<LibraryStartup> => {
    try {
      await backend.rollback();
    } catch {
      await opens(openLibrary);
      return blocked(
        "Novus could not return to your previous library. Restart Novus and try again.",
      );
    }
    try {
      await backend.relaunch();
      return blocked();
    } catch {
      await opens(openLibrary);
      return blocked(relaunchError);
    }
  };

  const resume = async (openLibrary: OpenLibrary): Promise<LibraryStartup> => {
    let restore: RestoreStatus | null;
    try {
      restore = await backend.status();
    } catch {
      return blocked(
        "Novus found an unfinished restore but could not check it. Restart Novus and try again.",
      );
    }

    if (!restore) {
      clearPreferenceRecovery();
      return (await opens(openLibrary))
        ? { ready: true }
        : blocked("Novus could not finish opening your library. Restart Novus and try again.");
    }

    if (restore.state === "installed") {
      if (!restoredPreferencesApplied(restore.backupCreatedAt)) {
        try {
          applyRestoredPreferences(restore.backupCreatedAt, restore.preferences);
          reload();
          return blocked();
        } catch {
          recoverPreferences();
          return rollback(
            openLibrary,
            "Novus could not apply the saved preferences. Restart Novus to return to your previous library.",
          );
        }
      }

      if (!(await opens(openLibrary))) {
        const preferences = recoverPreferences();
        return rollback(
          openLibrary,
          preferences === "failed"
            ? "Restart Novus to return to your previous library. Novus will also try to restore its previous preferences."
            : "Restart Novus to return to your previous library.",
        );
      }

      try {
        await backend.finish();
        clearPreferenceRecovery();
        return { ready: true };
      } catch {
        return blocked("Your library is restored, but Novus could not finish cleaning up.");
      }
    }

    if (restore.state === "failed") {
      const preferencesWereApplied = restoredPreferencesApplied(restore.backupCreatedAt);
      const preferences = recoverPreferences();
      let cancelled = true;
      try {
        await backend.cancel();
        if (preferences !== "failed") clearPreferenceRecovery();
      } catch {
        cancelled = false;
      }
      const opened = await opens(openLibrary);
      if (!opened) {
        return blocked("Novus could not finish opening your library. Restart Novus and try again.");
      }
      return {
        ready: cancelled,
        error:
          preferencesWereApplied && preferences !== "restored"
            ? "Novus kept your current library, but could not restore its previous preferences."
            : cancelled
              ? "Novus kept your current library because the restored copy could not be verified."
              : "Novus kept your current library, but could not finish cleaning up the failed restore.",
      };
    }

    if (restore.state === "prepared") {
      try {
        await backend.cancel();
        clearPreferenceRecovery();
      } catch {
        return blocked(
          "Novus could not cancel an unfinished restore. Restart Novus and try again.",
        );
      }
      return (await opens(openLibrary))
        ? { ready: true }
        : blocked("Novus could not finish opening your library. Restart Novus and try again.");
    }

    return blocked("Restart Novus to finish restoring your library.");
  };

  return {
    save: (path: string) => backend.save(path, currentPreferences()),
    prepare: (path: string) => backend.prepare(path),
    cancel: () => backend.cancel(),
    install: async (): Promise<boolean> => {
      await backend.commit();
      try {
        await backend.relaunch();
        return true;
      } catch {
        return false;
      }
    },
    resume,
  };
}

export const libraryCopy = createLibraryCopy(tauriBackend);
