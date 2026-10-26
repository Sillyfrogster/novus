import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, String(value));
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

const preferences = await import("../src/lib/preferences");
const { createLibraryCopy } = await import("../src/lib/libraryCopy");
const { registerErrorSink } = await import("../src/lib/errorReport");

beforeEach(() => {
  storage.clear();
  preferences.reloadPreferences();
});

function seedLegacyValues(): void {
  storage.setItem("novus.appTheme", "light");
  storage.setItem("novus.profileName", "Night reader");
  storage.setItem(
    "novus.readerSettings:v1",
    JSON.stringify({ fontSize: 22, layout: "scroll", brightness: "bright", measure: 4_000 }),
  );
  storage.setItem(
    "novus.highlightColors:v1",
    JSON.stringify({ rose: { label: "Quote", color: "#ABCDEF" } }),
  );
  storage.setItem("novus.continueShelfOpen", "0");
  storage.setItem("novus.lastSeenVersion", "0.4.0");
}

describe("durable preferences", () => {
  test("migrates supported legacy values and repairs malformed values", () => {
    seedLegacyValues();
    preferences.reloadPreferences();
    const migrated = preferences.currentPreferences();

    expect(migrated).toMatchObject({
      appTheme: "light",
      profileName: "Night reader",
      readerSettings: {
        fontSize: 22,
        layout: "scroll",
        brightness: 1,
        measure: 720,
      },
      highlightColors: {
        rose: { label: "Quote", color: "#abcdef" },
      },
      continueShelfOpen: false,
    });
    expect(storage.getItem("novus.readerSettings:v1")).toBeNull();
    expect(storage.getItem("novus.lastSeenVersion")).toBe("0.4.0");
  });

  test("recovers the exact preferences from before a library replacement", () => {
    storage.clear();
    const previous = preferences.replacePreferences({
      appTheme: "dark",
      profileName: "Original library",
      readerSettings: { fontSize: 17, readTheme: "sepia" },
      highlightColors: { sage: { label: "Notes", color: "#789abc" } },
      continueShelfOpen: true,
    });

    preferences.applyRestoredPreferences(123, {
      appTheme: "light",
      profileName: "Restored library",
      readerSettings: { fontSize: 24 },
      highlightColors: {},
      continueShelfOpen: false,
    });
    preferences.applyRestoredPreferences(123, {
      appTheme: "dark",
      profileName: "Should not be reapplied",
    });

    expect(preferences.currentPreferences().profileName).toBe("Restored library");
    expect(preferences.recoverPreviousPreferences()).toBe(true);
    expect(preferences.currentPreferences()).toEqual(previous);
  });

  test("finishes an opened replacement and rolls back one that cannot open", async () => {
    storage.clear();
    const previous = preferences.replacePreferences({ profileName: "Original library" });
    const restored = preferences.decodePreferences({ profileName: "Restored library" });
    let status: ReturnType<typeof installedStatus> | null = installedStatus(101, restored);
    let finished = 0;
    let rolledBack = 0;
    let relaunched = 0;
    let reloaded = 0;
    const backend = {
      save: async () => ({ createdAt: 0, bookCount: 0, fileCount: 0, byteCount: 0 }),
      prepare: async () => ({ backupCreatedAt: 0, bookCount: 0, fileCount: 0 }),
      commit: async () => undefined,
      cancel: async () => undefined,
      status: async () => status,
      finish: async () => {
        finished += 1;
        status = null;
      },
      rollback: async () => {
        rolledBack += 1;
      },
      relaunch: async () => {
        relaunched += 1;
      },
    };
    const copy = createLibraryCopy(backend, () => {
      reloaded += 1;
    });

    expect((await copy.resume(async () => true)).ready).toBe(false);
    expect(reloaded).toBe(1);
    expect(preferences.currentPreferences().profileName).toBe("Restored library");
    expect((await copy.resume(async () => true)).ready).toBe(true);
    expect(finished).toBe(1);

    preferences.replacePreferences(previous);
    status = installedStatus(202, restored);
    await copy.resume(async () => true);
    const result = await copy.resume(async () => false);

    expect(result.ready).toBe(false);
    expect(rolledBack).toBe(1);
    expect(relaunched).toBe(1);
    expect(preferences.currentPreferences()).toEqual(previous);
  });
});

/** Runs the callback with every storage write throwing, then restores the real write. */
function withFailingWrites<T>(run: () => T): T {
  const write = storage.setItem;
  storage.setItem = () => {
    throw new Error("quota exceeded");
  };
  try {
    return run();
  } finally {
    storage.setItem = write;
  }
}

/** Fails only the settings write, so the recovery record can still be saved. */
function withFailingPreferenceWrites<T>(run: () => T): T {
  const write = storage.setItem;
  storage.setItem = function (this: Storage, key: string, value: string) {
    if (key === "novus.preferences") throw new Error("quota exceeded");
    return write.call(storage, key, value);
  };
  try {
    return run();
  } finally {
    storage.setItem = write;
  }
}

describe("failed preference saves", () => {
  afterEach(() => {
    registerErrorSink(() => undefined);
  });

  test("keeps a changed setting in state when the write fails", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);

    withFailingWrites(() => preferences.setProfileName("Kept for the session"));

    expect(preferences.currentPreferences().profileName).toBe("Kept for the session");
    consoleError.mockRestore();
  });

  test("reports the settings copy and logs the raw error when the write fails", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);
    const reported: string[] = [];
    registerErrorSink((text) => {
      reported.push(text);
    });

    withFailingWrites(() => preferences.setProfileName("Reported"));

    expect(reported).toEqual(["Couldn't save your settings. They'll reset when Novus restarts."]);
    expect(consoleError).toHaveBeenCalledWith(
      "Couldn't save your settings. They'll reset when Novus restarts.",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});

function installedStatus(
  backupCreatedAt: number,
  restored: ReturnType<typeof preferences.currentPreferences>,
) {
  return {
    state: "installed" as const,
    backupCreatedAt,
    bookCount: 1,
    fileCount: 2,
    preferences: restored,
    error: null,
  };
}

type LibraryCopyBackend = Parameters<typeof createLibraryCopy>[0];
type BackendStatus = Awaited<ReturnType<LibraryCopyBackend["status"]>>;

/** Like withFailingPreferenceWrites, but for an async callback. */
async function withFailingPreferenceWritesAsync<T>(run: () => Promise<T>): Promise<T> {
  const write = storage.setItem;
  storage.setItem = function (this: Storage, key: string, value: string) {
    if (key === "novus.preferences") throw new Error("quota exceeded");
    return write.call(storage, key, value);
  };
  try {
    return await run();
  } finally {
    storage.setItem = write;
  }
}

function failedStatus(
  backupCreatedAt: number,
  restored: ReturnType<typeof preferences.currentPreferences>,
) {
  return {
    state: "failed" as const,
    backupCreatedAt,
    bookCount: 1,
    fileCount: 2,
    preferences: restored,
    error: null,
  };
}

interface RestoreBackendState {
  status: BackendStatus;
  calls: string[];
}

/** A backend whose status is driven by state; cancel and finish clear it, as the Rust side does. */
function restoreBackend(state: RestoreBackendState): LibraryCopyBackend {
  return {
    save: async () => ({ createdAt: 0, bookCount: 0, fileCount: 0, byteCount: 0 }),
    prepare: async () => {
      state.calls.push("prepare");
      return { backupCreatedAt: 0, bookCount: 0, fileCount: 0 };
    },
    commit: async () => undefined,
    cancel: async () => {
      state.calls.push("cancel");
      state.status = null;
    },
    status: async () => state.status,
    finish: async () => {
      state.calls.push("finish");
      state.status = null;
    },
    rollback: async () => {
      state.calls.push("rollback");
    },
    relaunch: async () => {
      state.calls.push("relaunch");
    },
  };
}

describe("restore and rollback writes", () => {
  test("applyRestoredPreferences throws and leaves the restore unapplied when the settings write fails", () => {
    storage.clear();
    preferences.replacePreferences({ profileName: "Original library" });

    withFailingPreferenceWrites(() =>
      expect(() =>
        preferences.applyRestoredPreferences(456, { profileName: "Restored library" }),
      ).toThrow("quota exceeded"),
    );

    expect(preferences.restoredPreferencesApplied(456)).toBe(false);
    expect(preferences.currentPreferences().profileName).toBe("Original library");
    expect(preferences.preferenceRecoverySaved()).toBe(true);
  });

  test("recoverPreviousPreferences throws and keeps the recovery record when the settings write fails", () => {
    storage.clear();
    preferences.replacePreferences({ profileName: "Original library" });
    preferences.applyRestoredPreferences(789, { profileName: "Restored library" });

    withFailingPreferenceWrites(() =>
      expect(() => preferences.recoverPreviousPreferences()).toThrow("quota exceeded"),
    );

    expect(preferences.preferenceRecoverySaved()).toBe(true);
    expect(preferences.currentPreferences().profileName).toBe("Restored library");
  });
});

describe("resume after a failed settings write", () => {
  afterEach(() => {
    // The record must not leak to other test files that share the global localStorage in one bun process.
    storage.clear();
    preferences.reloadPreferences();
  });

  test("a failed revert keeps its record through a later start with no restore journal until a settings write succeeds", async () => {
    preferences.replacePreferences({ profileName: "Original library" });
    preferences.applyRestoredPreferences(456, { profileName: "Restored library" });
    const state: RestoreBackendState = {
      status: failedStatus(456, preferences.currentPreferences()),
      calls: [],
    };
    const copy = createLibraryCopy(restoreBackend(state), () => undefined);
    const sameError =
      "Novus kept your current library, but could not restore its previous preferences.";

    // Start 1: the failed branch reverts, the settings write fails, and the journal is cancelled.
    const first = await withFailingPreferenceWritesAsync(() => copy.resume(async () => true));
    expect(first.ready).toBe(true);
    expect(first.error).toBe(sameError);
    expect(state.calls).toContain("cancel");

    // Start 2: no journal is left, and the settings write still fails.
    const second = await withFailingPreferenceWritesAsync(() => copy.resume(async () => true));
    expect(preferences.preferenceRecoverySaved()).toBe(true);
    expect(second.error).toBe(sameError);

    // Start 3: the settings write works, so the previous preferences come back and the record clears.
    const third = await copy.resume(async () => true);
    expect(preferences.currentPreferences().profileName).toBe("Original library");
    expect(preferences.preferenceRecoverySaved()).toBe(false);
    expect(third.ready).toBe(true);
    expect(third.error).toBeUndefined();
  });
});
