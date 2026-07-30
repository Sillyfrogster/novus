import { beforeEach, describe, expect, test } from "bun:test";

import {
  applyLibraryPreferences,
  clearPreviousLibraryPreferences,
  currentLibraryPreferences,
  previousLibraryPreferencesSaved,
  rememberPreviousLibraryPreferences,
  restorePreviousLibraryPreferences,
} from "../src/lib/libraryBackup";

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

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage,
});

beforeEach(() => {
  localStorage.clear();
});

describe("library backup preferences", () => {
  test("keeps only durable reader preferences", () => {
    localStorage.setItem("novus.appTheme", "light");
    localStorage.setItem("novus.profileName", "Night reader");
    localStorage.setItem("novus.readerSettings:v1", '{"fontSize":19}');
    localStorage.setItem("novus.highlightColors:v1", '{"amber":"#c90"}');
    localStorage.setItem("novus.continueShelfOpen", "0");
    localStorage.setItem("novus.lastSeenVersion", "0.4.0");

    expect(currentLibraryPreferences()).toEqual({
      appTheme: "light",
      profileName: "Night reader",
      readerSettings: { fontSize: 19 },
      highlightColors: { amber: "#c90" },
      continueShelfOpen: false,
    });
  });

  test("restores the preferences from before a library replacement", () => {
    applyLibraryPreferences({
      appTheme: "dark",
      profileName: "Original library",
      readerSettings: { fontSize: 17 },
      highlightColors: { rose: "#a55" },
      continueShelfOpen: true,
    });
    rememberPreviousLibraryPreferences();

    applyLibraryPreferences({
      appTheme: "light",
      profileName: "Restored library",
      readerSettings: { fontSize: 22 },
      highlightColors: {},
      continueShelfOpen: false,
    });
    rememberPreviousLibraryPreferences();

    expect(restorePreviousLibraryPreferences()).toBe(true);
    expect(currentLibraryPreferences()).toEqual({
      appTheme: "dark",
      profileName: "Original library",
      readerSettings: { fontSize: 17 },
      highlightColors: { rose: "#a55" },
      continueShelfOpen: true,
    });
  });

  test("keeps the previous preferences until recovery is complete", () => {
    rememberPreviousLibraryPreferences();
    expect(previousLibraryPreferencesSaved()).toBe(true);

    clearPreviousLibraryPreferences();

    expect(previousLibraryPreferencesSaved()).toBe(false);
    expect(restorePreviousLibraryPreferences()).toBe(false);
  });
});
