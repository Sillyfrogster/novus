import { describe, expect, test } from "bun:test";

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

const preferences = await import("../src/lib/preferences");
const { createLibraryCopy } = await import("../src/lib/libraryCopy");
const migrated = preferences.currentPreferences();

describe("durable preferences", () => {
  test("migrates supported legacy values and repairs malformed values", () => {
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
      commit: async () => {},
      cancel: async () => {},
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
