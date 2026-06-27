import { create } from "zustand";

import { messageOf } from "../lib/errors";
import { checkForUpdate, downloadAndInstall, relaunchApp, type Update } from "../lib/updater";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "upToDate"
  | "error";

interface AvailableUpdate {
  version: string;
  notes: string;
}

/** Don't auto-check more than once per this window (manual checks ignore it). */
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "novus.lastUpdateCheck";

interface UpdateState {
  status: UpdateStatus;
  available: AvailableUpdate | null;
  progress: number;
  error: string | null;
  bannerDismissed: boolean;

  check: (silent: boolean) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  dismissBanner: () => void;
}

let pendingUpdate: Update | null = null;

export const useUpdate = create<UpdateState>((set, get) => ({
  status: "idle",
  available: null,
  progress: 0,
  error: null,
  bannerDismissed: false,

  check: async (silent) => {
    const { status } = get();
    if (status === "checking" || status === "downloading") return;

    if (silent) {
      const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
      if (Date.now() - last < AUTO_CHECK_INTERVAL_MS) return;
    }

    set({ status: "checking", error: null });
    try {
      const update = await checkForUpdate();
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      if (update) {
        pendingUpdate = update;
        set({
          status: "available",
          available: { version: update.version, notes: update.body ?? "" },
          bannerDismissed: false,
        });
      } else {
        pendingUpdate = null;
        set({ status: "upToDate", available: null });
      }
    } catch (e) {
      pendingUpdate = null;
      if (silent) {
        set({ status: "idle" });
      } else {
        set({ status: "error", error: messageOf(e) });
      }
    }
  },

  install: async () => {
    if (!pendingUpdate) return;
    set({ status: "downloading", progress: 0, error: null });
    try {
      await downloadAndInstall(pendingUpdate, (fraction) => set({ progress: fraction }));
      set({ status: "ready", progress: 1 });
    } catch (e) {
      set({ status: "error", error: messageOf(e) });
    }
  },

  restart: async () => {
    try {
      await relaunchApp();
    } catch (e) {
      set({ status: "error", error: messageOf(e) });
    }
  },

  dismissBanner: () => set({ bannerDismissed: true }),
}));
