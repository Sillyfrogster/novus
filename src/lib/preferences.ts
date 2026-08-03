import { create } from "zustand";

import type {
  AppTheme,
  HighlightColorKey,
  ReadFont,
  ReadLayout,
  ReadTheme,
  TextAlign,
} from "./types";

const PREFERENCES_KEY = "novus.preferences";
const RECOVERY_KEY = "novus.preferenceRecovery";
const VERSION = 1;

const LEGACY_KEYS = {
  appTheme: "novus.appTheme",
  profileName: "novus.profileName",
  reader: ["novus.readerSettings:v1", "novus.readerSettings"],
  colors: ["novus.highlightColors:v1", "novus.highlightColors"],
  continueShelf: "novus.continueShelfOpen",
} as const;

export const MEASURE_MIN = 560;
export const MEASURE_MAX = 1000;
export const MEASURE_STEP = 40;

export interface ReaderSettings {
  readTheme: ReadTheme;
  font: ReadFont;
  fontSize: number;
  lineHeight: number;
  measure: number;
  paragraphSpacing: number;
  align: TextAlign;
  layout: ReadLayout;
  brightness: number;
}

export interface HighlightColor {
  label: string;
  color: string;
}

export type HighlightColors = Record<HighlightColorKey, HighlightColor>;

export interface PreferencesSnapshot {
  appTheme: AppTheme;
  profileName: string;
  readerSettings: ReaderSettings;
  highlightColors: HighlightColors;
  continueShelfOpen: boolean;
}

export const HIGHLIGHT_COLOR_KEYS: readonly HighlightColorKey[] = [
  "slate",
  "sage",
  "violet",
  "rose",
];

const DEFAULT_READER_SETTINGS: ReaderSettings = {
  readTheme: "dark",
  font: "serif",
  fontSize: 19,
  lineHeight: 1.7,
  measure: 720,
  paragraphSpacing: 0.5,
  align: "left",
  layout: "paged",
  brightness: 1,
};

const DEFAULT_HIGHLIGHT_COLORS: HighlightColors = {
  slate: { label: "Slate", color: "#9fb4d0" },
  sage: { label: "Sage", color: "#9bbcaf" },
  violet: { label: "Violet", color: "#b3a6d4" },
  rose: { label: "Rose", color: "#d3a3ad" },
};

const DEFAULT_PREFERENCES: PreferencesSnapshot = {
  appTheme: "dark",
  profileName: "Guest library",
  readerSettings: DEFAULT_READER_SETTINGS,
  highlightColors: DEFAULT_HIGHLIGHT_COLORS,
  continueShelfOpen: true,
};

interface RecoveryRecord {
  version: number;
  backupCreatedAt: number;
  previous: PreferencesSnapshot;
  applied: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? (value as T) : fallback;
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function profileName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_PREFERENCES.profileName;
  const trimmed = value.trim();
  return trimmed ? [...trimmed].slice(0, 200).join("") : DEFAULT_PREFERENCES.profileName;
}

function readerSettings(value: unknown): ReaderSettings {
  const input = isRecord(value) ? value : {};
  return {
    readTheme: oneOf(input.readTheme, ["light", "sepia", "dark"], "dark"),
    font: oneOf(input.font, ["serif", "sans", "modern"], "serif"),
    fontSize: numberIn(input.fontSize, 15, 26, DEFAULT_READER_SETTINGS.fontSize),
    lineHeight: numberIn(input.lineHeight, 1.3, 2.2, DEFAULT_READER_SETTINGS.lineHeight),
    measure: numberIn(input.measure, MEASURE_MIN, MEASURE_MAX, DEFAULT_READER_SETTINGS.measure),
    paragraphSpacing: numberIn(
      input.paragraphSpacing,
      0,
      1.4,
      DEFAULT_READER_SETTINGS.paragraphSpacing,
    ),
    align: oneOf(input.align, ["left", "justify"], "left"),
    layout: oneOf(input.layout, ["paged", "scroll"], "paged"),
    brightness: numberIn(input.brightness, 0.45, 1, DEFAULT_READER_SETTINGS.brightness),
  };
}

function highlightColors(value: unknown): HighlightColors {
  const input = isRecord(value) ? value : {};
  const colors = {} as HighlightColors;
  for (const key of HIGHLIGHT_COLOR_KEYS) {
    const candidate = isRecord(input[key]) ? input[key] : {};
    const label =
      typeof candidate.label === "string" && candidate.label.trim()
        ? [...candidate.label.trim()].slice(0, 80).join("")
        : DEFAULT_HIGHLIGHT_COLORS[key].label;
    const color =
      typeof candidate.color === "string" && /^#[0-9a-f]{6}$/i.test(candidate.color)
        ? candidate.color.toLowerCase()
        : DEFAULT_HIGHLIGHT_COLORS[key].color;
    colors[key] = { label, color };
  }
  return colors;
}

export function decodePreferences(value: unknown): PreferencesSnapshot {
  const envelope = isRecord(value) && isRecord(value.preferences) ? value.preferences : value;
  const input = isRecord(envelope) ? envelope : {};
  return {
    appTheme: oneOf(input.appTheme, ["light", "dark"], "dark"),
    profileName: profileName(input.profileName),
    readerSettings: readerSettings(input.readerSettings),
    highlightColors: highlightColors(input.highlightColors),
    continueShelfOpen:
      typeof input.continueShelfOpen === "boolean" ? input.continueShelfOpen : true,
  };
}

function clonePreferences(preferences: PreferencesSnapshot): PreferencesSnapshot {
  return {
    ...preferences,
    readerSettings: { ...preferences.readerSettings },
    highlightColors: highlightColors(preferences.highlightColors),
  };
}

function browserStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function parsedAt(storage: Storage, key: string): unknown {
  const raw = storage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function persistPreferences(preferences: PreferencesSnapshot): void {
  browserStorage()?.setItem(
    PREFERENCES_KEY,
    JSON.stringify({ version: VERSION, preferences }),
  );
}

function loadPreferences(): PreferencesSnapshot {
  const storage = browserStorage();
  if (!storage) return clonePreferences(DEFAULT_PREFERENCES);

  if (storage.getItem(PREFERENCES_KEY) !== null) {
    const preferences = decodePreferences(parsedAt(storage, PREFERENCES_KEY));
    try {
      persistPreferences(preferences);
    } catch {
    }
    return preferences;
  }

  const legacyKeys = [
    LEGACY_KEYS.appTheme,
    LEGACY_KEYS.profileName,
    ...LEGACY_KEYS.reader,
    ...LEGACY_KEYS.colors,
    LEGACY_KEYS.continueShelf,
  ];
  if (!legacyKeys.some((key) => storage.getItem(key) !== null)) {
    return clonePreferences(DEFAULT_PREFERENCES);
  }

  const preferences = decodePreferences({
    appTheme: storage.getItem(LEGACY_KEYS.appTheme),
    profileName: storage.getItem(LEGACY_KEYS.profileName),
    readerSettings:
      parsedAt(storage, LEGACY_KEYS.reader[0]) ?? parsedAt(storage, LEGACY_KEYS.reader[1]),
    highlightColors:
      parsedAt(storage, LEGACY_KEYS.colors[0]) ?? parsedAt(storage, LEGACY_KEYS.colors[1]),
    continueShelfOpen: storage.getItem(LEGACY_KEYS.continueShelf) !== "0",
  });

  try {
    persistPreferences(preferences);
    for (const key of legacyKeys) storage.removeItem(key);
  } catch {
  }
  return preferences;
}

function snapshotFrom(state: PreferencesSnapshot): PreferencesSnapshot {
  return clonePreferences(state);
}

export const usePreferences = create<PreferencesSnapshot>(() => loadPreferences());

function commit(preferences: PreferencesSnapshot): void {
  persistPreferences(preferences);
  usePreferences.setState(preferences);
}

function update(patch: Partial<PreferencesSnapshot>): void {
  commit({ ...currentPreferences(), ...patch });
}

export function toggleAppTheme(): void {
  const appTheme = usePreferences.getState().appTheme === "dark" ? "light" : "dark";
  update({ appTheme });
}

export function setProfileName(name: string): void {
  update({ profileName: profileName(name) });
}

export function setReaderSetting<K extends keyof ReaderSettings>(
  key: K,
  value: ReaderSettings[K],
): void {
  const current = usePreferences.getState().readerSettings;
  update({ readerSettings: readerSettings({ ...current, [key]: value }) });
}

export function setContinueShelfOpen(continueShelfOpen: boolean): void {
  update({ continueShelfOpen });
}

function updateHighlightColor(
  key: HighlightColorKey,
  patch: Partial<HighlightColor>,
): void {
  const current = usePreferences.getState().highlightColors;
  update({
    highlightColors: highlightColors({
      ...current,
      [key]: { ...current[key], ...patch },
    }),
  });
}

export function renameHighlightColor(key: HighlightColorKey, label: string): void {
  updateHighlightColor(key, { label });
}

export function recolorHighlight(key: HighlightColorKey, color: string): void {
  updateHighlightColor(key, { color });
}

export function resetHighlightColor(key: HighlightColorKey): void {
  const current = usePreferences.getState().highlightColors;
  update({
    highlightColors: { ...current, [key]: { ...DEFAULT_HIGHLIGHT_COLORS[key] } },
  });
}

export function currentPreferences(): PreferencesSnapshot {
  return snapshotFrom(usePreferences.getState());
}

export function replacePreferences(value: unknown): PreferencesSnapshot {
  const preferences = decodePreferences(value);
  persistPreferences(preferences);
  usePreferences.setState(preferences);
  return clonePreferences(preferences);
}

function readRecovery(): RecoveryRecord | null {
  const storage = browserStorage();
  if (!storage) return null;
  const value = parsedAt(storage, RECOVERY_KEY);
  if (
    !isRecord(value) ||
    value.version !== VERSION ||
    typeof value.backupCreatedAt !== "number" ||
    !Number.isFinite(value.backupCreatedAt) ||
    typeof value.applied !== "boolean" ||
    !isRecord(value.previous)
  ) {
    return null;
  }
  return {
    version: VERSION,
    backupCreatedAt: value.backupCreatedAt,
    previous: decodePreferences(value.previous),
    applied: value.applied,
  };
}

function writeRecovery(recovery: RecoveryRecord): void {
  browserStorage()?.setItem(RECOVERY_KEY, JSON.stringify(recovery));
}

export function applyRestoredPreferences(createdAt: number, value: unknown): void {
  let recovery = readRecovery();
  if (!recovery || recovery.backupCreatedAt !== createdAt) {
    recovery = {
      version: VERSION,
      backupCreatedAt: createdAt,
      previous: currentPreferences(),
      applied: false,
    };
    writeRecovery(recovery);
  }
  if (recovery.applied) return;

  replacePreferences(value);
  writeRecovery({ ...recovery, applied: true });
}

export function restoredPreferencesApplied(createdAt: number): boolean {
  const recovery = readRecovery();
  return recovery?.backupCreatedAt === createdAt && recovery.applied;
}

export function recoverPreviousPreferences(): boolean {
  const recovery = readRecovery();
  if (!recovery) return false;
  replacePreferences(recovery.previous);
  return true;
}

export function preferenceRecoverySaved(): boolean {
  return readRecovery() !== null;
}

export function clearPreferenceRecovery(): void {
  browserStorage()?.removeItem(RECOVERY_KEY);
}
