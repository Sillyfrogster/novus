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
});
