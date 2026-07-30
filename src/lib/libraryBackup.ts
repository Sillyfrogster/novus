import type { LibraryPreferences } from "./ipc";

const APP_THEME_KEY = "novus.appTheme";
const PROFILE_KEY = "novus.profileName";
const READER_SETTINGS_KEY = "novus.readerSettings:v1";
const HIGHLIGHT_COLORS_KEY = "novus.highlightColors:v1";
const CONTINUE_OPEN_KEY = "novus.continueShelfOpen";
const RESTORE_APPLIED_KEY = "novus.restoreApplied";
const PREVIOUS_PREFERENCES_KEY = "novus.restorePreviousPreferences";

function objectAt(key: string): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function currentLibraryPreferences(): LibraryPreferences {
  return {
    appTheme: localStorage.getItem(APP_THEME_KEY) === "light" ? "light" : "dark",
    profileName: localStorage.getItem(PROFILE_KEY) || "Guest library",
    readerSettings: objectAt(READER_SETTINGS_KEY),
    highlightColors: objectAt(HIGHLIGHT_COLORS_KEY),
    continueShelfOpen: localStorage.getItem(CONTINUE_OPEN_KEY) !== "0",
  };
}

export function applyLibraryPreferences(preferences: LibraryPreferences): void {
  localStorage.setItem(APP_THEME_KEY, preferences.appTheme);
  localStorage.setItem(PROFILE_KEY, preferences.profileName);
  localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(preferences.readerSettings));
  localStorage.setItem(HIGHLIGHT_COLORS_KEY, JSON.stringify(preferences.highlightColors));
  localStorage.setItem(CONTINUE_OPEN_KEY, preferences.continueShelfOpen ? "1" : "0");
}

export function rememberPreviousLibraryPreferences(): void {
  if (localStorage.getItem(PREVIOUS_PREFERENCES_KEY) !== null) return;
  localStorage.setItem(
    PREVIOUS_PREFERENCES_KEY,
    JSON.stringify(currentLibraryPreferences()),
  );
}

export function restorePreviousLibraryPreferences(): boolean {
  const saved = localStorage.getItem(PREVIOUS_PREFERENCES_KEY);
  if (!saved) return false;
  const preferences = JSON.parse(saved) as Partial<LibraryPreferences>;
  if (
    (preferences.appTheme !== "light" && preferences.appTheme !== "dark") ||
    typeof preferences.profileName !== "string" ||
    !isRecord(preferences.readerSettings) ||
    !isRecord(preferences.highlightColors) ||
    typeof preferences.continueShelfOpen !== "boolean"
  ) {
    throw new Error("The previous library preferences are invalid");
  }
  applyLibraryPreferences(preferences as LibraryPreferences);
  return true;
}

export function clearPreviousLibraryPreferences(): void {
  localStorage.removeItem(PREVIOUS_PREFERENCES_KEY);
}

export function previousLibraryPreferencesSaved(): boolean {
  return localStorage.getItem(PREVIOUS_PREFERENCES_KEY) !== null;
}

export function restoredLibraryApplied(createdAt: number): boolean {
  return localStorage.getItem(RESTORE_APPLIED_KEY) === String(createdAt);
}

export function markRestoredLibraryApplied(createdAt: number): void {
  localStorage.setItem(RESTORE_APPLIED_KEY, String(createdAt));
}

export function clearRestoredLibraryApplied(): void {
  localStorage.removeItem(RESTORE_APPLIED_KEY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
