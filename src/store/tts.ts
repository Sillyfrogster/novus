import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";

import {
  deleteVoicePack,
  downloadVoicePack,
  fetchVoiceRegistry,
  listVoicePacks,
  ttsShutdown,
  type InstalledVoicePack,
  type VoicePackManifest,
  type VoicePackProgress,
} from "../lib/ipc";

const SETTINGS_KEY = "novus.ttsSettings";
const BOOK_PREFS_KEY = "novus.ttsBookPrefs";

export const SPEED_MIN = 0.75;
export const SPEED_MAX = 3;
export const SPEED_STEP = 0.25;

/** Playback surface state */
export type PlayerStatus = "idle" | "preparing" | "playing" | "paused" | "stalled" | "error";

interface TtsSelection {
  packId: string | null;
  voiceId: string | null;
  speed: number;
}

interface BookPrefs {
  packId: string;
  voiceId: string;
  speed: number;
}

const DEFAULTS: TtsSelection = { packId: null, voiceId: null, speed: 1 };

function loadSelection(): TtsSelection {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const merged = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<TtsSelection>) };
      if (merged.speed < SPEED_MIN || merged.speed > SPEED_MAX) merged.speed = 1;
      return merged;
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULTS;
}

function loadBookPrefs(): Record<string, BookPrefs> {
  try {
    const raw = localStorage.getItem(BOOK_PREFS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, BookPrefs>;
  } catch {
    // fall through
  }
  return {};
}

export type SleepChoice = "off" | "15" | "30" | "60" | "chapter";

interface TtsStore extends TtsSelection {
  sleep: SleepChoice;
  setSleep: (choice: SleepChoice) => void;
  registry: VoicePackManifest[];
  installed: InstalledVoicePack[];
  registryError: string | null;
  downloading: Record<string, number>;
  actionError: string | null;
  status: PlayerStatus;
  playerError: string | null;

  refresh: () => Promise<void>;
  download: (manifest: VoicePackManifest) => Promise<void>;
  remove: (packId: string) => Promise<void>;
  select: (packId: string, voiceId: string) => void;
  setSpeed: (speed: number) => void;
  applyBookPrefs: (bookId: string) => void;
  rememberForBook: (bookId: string) => void;
  setStatus: (status: PlayerStatus, error?: string | null) => void;
}

function persistSelection(s: TtsSelection): void {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ packId: s.packId, voiceId: s.voiceId, speed: s.speed }),
  );
}

export const useTts = create<TtsStore>((set, get) => ({
  ...loadSelection(),
  registry: [],
  installed: [],
  registryError: null,
  downloading: {},
  actionError: null,
  status: "idle",
  playerError: null,
  sleep: "off",
  setSleep: (choice) => set({ sleep: choice }),

  refresh: async () => {
    try {
      const installed = await listVoicePacks();
      set({ installed });
      const { packId } = get();
      if (packId && !installed.some((p) => p.id === packId)) {
        set({ packId: null, voiceId: null });
        persistSelection(get());
      }
    } catch (error: unknown) {
      set({ actionError: message(error) });
    }
    try {
      const registry = await fetchVoiceRegistry();
      set({ registry, registryError: null });
    } catch (error: unknown) {
      set({ registryError: message(error) });
    }
  },

  download: async (manifest) => {
    set((s) => ({
      downloading: { ...s.downloading, [manifest.id]: 0 },
      actionError: null,
    }));
    try {
      await downloadVoicePack(manifest);
      const installed = await listVoicePacks();
      set({ installed });
      if (!get().packId) {
        const pack = installed.find((p) => p.id === manifest.id);
        const voice = pack?.voices[0];
        if (pack && voice) get().select(pack.id, voice.id);
      }
    } catch (error: unknown) {
      set({ actionError: message(error) });
    } finally {
      set((s) => {
        const { [manifest.id]: _done, ...rest } = s.downloading;
        return { downloading: rest };
      });
    }
  },

  remove: async (packId) => {
    try {
      await deleteVoicePack(packId);
      const installed = await listVoicePacks();
      set({ installed, actionError: null });
      if (get().packId === packId) {
        set({ packId: null, voiceId: null });
        persistSelection(get());
      }
    } catch (error: unknown) {
      set({ actionError: message(error) });
    }
  },

  select: (packId, voiceId) => {
    set({ packId, voiceId });
    persistSelection(get());
  },

  setSpeed: (speed) => {
    const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
    set({ speed: clamped });
    persistSelection(get());
  },

  applyBookPrefs: (bookId) => {
    const prefs = loadBookPrefs()[bookId];
    if (!prefs) return;
    if (get().installed.some((p) => p.id === prefs.packId)) {
      set({ packId: prefs.packId, voiceId: prefs.voiceId, speed: prefs.speed });
    }
  },

  rememberForBook: (bookId) => {
    const { packId, voiceId, speed } = get();
    if (!packId || !voiceId) return;
    const all = { ...loadBookPrefs(), [bookId]: { packId, voiceId, speed } };
    localStorage.setItem(BOOK_PREFS_KEY, JSON.stringify(all));
  },

  setStatus: (status, error = null) => set({ status, playerError: error }),
}));

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Download progress events stream straight into the store.
void listen<VoicePackProgress>("voice-pack-progress", (event) => {
  const { packId, received, total } = event.payload;
  useTts.setState((s) => {
    if (!(packId in s.downloading)) return s;
    const fraction = total > 0 ? Math.min(1, received / total) : 0;
    return { downloading: { ...s.downloading, [packId]: fraction } };
  });
});

/** Stop the engine when the app window goes away. */
window.addEventListener("beforeunload", () => {
  void ttsShutdown();
});
