import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";

import {
  createCollection,
  deleteCollection,
  importBooks,
  listBooks,
  listCollections,
  removeBook,
  setCollectionMembership,
  storageRoot,
  weekStats,
} from "../lib/ipc";
import type { AppTheme, Book, Collection, View, WeekStats } from "../lib/types";

const THEME_KEY = "novus.appTheme";
const PROFILE_KEY = "novus.profileName";

function initialTheme(): AppTheme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" ? "light" : "dark";
}

function initialProfileName(): string {
  return localStorage.getItem(PROFILE_KEY) || "Guest library";
}

interface LibraryState {
  appTheme: AppTheme;
  view: View;
  aboutOpen: boolean;
  aboutHighlightSince: string | null;
  activeBookId: string | null;
  pendingLocator: string | null;
  books: Book[];
  collections: Collection[];
  selectedCollectionId: number | null;
  stats: WeekStats | null;
  profileName: string;
  storageRoot: string;
  loading: boolean;
  importing: boolean;
  error: string | null;

  toggleTheme: () => void;
  openAbout: (highlightSince?: string | null) => void;
  closeAbout: () => void;
  openReader: (id: string, locator?: string | null) => void;
  consumePendingLocator: () => string | null;
  goLibrary: () => void;
  loadLibrary: () => Promise<void>;
  pickAndImport: () => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
  removeBookById: (id: string) => Promise<void>;
  clearError: () => void;

  selectCollection: (id: number | null) => void;
  addCollection: (name: string) => Promise<void>;
  removeCollection: (id: number) => Promise<void>;
  toggleMembership: (collectionId: number, bookId: string, member: boolean) => Promise<void>;
  setProfileName: (name: string) => void;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  appTheme: initialTheme(),
  view: "library",
  aboutOpen: false,
  aboutHighlightSince: null,
  activeBookId: null,
  pendingLocator: null,
  books: [],
  collections: [],
  selectedCollectionId: null,
  stats: null,
  profileName: initialProfileName(),
  storageRoot: "",
  loading: true,
  importing: false,
  error: null,

  toggleTheme: () =>
    set((s) => {
      const next: AppTheme = s.appTheme === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      return { appTheme: next };
    }),

  openAbout: (highlightSince = null) =>
    set({ aboutOpen: true, aboutHighlightSince: highlightSince }),

  closeAbout: () => set({ aboutOpen: false, aboutHighlightSince: null }),

  openReader: (id, locator) =>
    set({ view: "reader", activeBookId: id, pendingLocator: locator ?? null }),

  consumePendingLocator: () => {
    const locator = get().pendingLocator;
    if (locator !== null) set({ pendingLocator: null });
    return locator;
  },

  // Returning to the library refreshes progress
  goLibrary: () => {
    set({ view: "library", activeBookId: null, pendingLocator: null });
    get().loadLibrary();
  },

  loadLibrary: async () => {
    set({ loading: true, error: null });
    try {
      const [books, root, collections, stats] = await Promise.all([
        listBooks(),
        get().storageRoot ? Promise.resolve(get().storageRoot) : storageRoot(),
        listCollections(),
        weekStats(),
      ]);
      const selectedCollectionId = collections.some(
        (c) => c.id === get().selectedCollectionId,
      )
        ? get().selectedCollectionId
        : null;
      set({ books, storageRoot: root, collections, stats, selectedCollectionId, loading: false });
    } catch (e) {
      set({ error: messageOf(e), loading: false });
    }
  },

  pickAndImport: async () => {
    const selection = await open({
      multiple: true,
      filters: [{ name: "Books", extensions: ["epub"] }],
    });
    if (!selection) return;
    const paths = Array.isArray(selection) ? selection : [selection];
    await get().importPaths(paths);
  },

  importPaths: async (paths) => {
    if (paths.length === 0) return;
    set({ importing: true, error: null });
    try {
      const summary = await importBooks(paths);
      const books = await listBooks();
      const error =
        summary.failed.length > 0
          ? `Could not import ${summary.failed.length} file(s)`
          : null;
      set({ books, importing: false, error });
    } catch (e) {
      set({ error: messageOf(e), importing: false });
    }
  },

  removeBookById: async (id) => {
    try {
      await removeBook(id);
      set((s) => ({
        books: s.books.filter((b) => b.id !== id),
        collections: s.collections.map((c) => ({
          ...c,
          bookIds: c.bookIds.filter((bid) => bid !== id),
        })),
      }));
    } catch (e) {
      set({ error: messageOf(e) });
    }
  },

  clearError: () => set({ error: null }),

  selectCollection: (id) => set({ selectedCollectionId: id }),

  addCollection: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const collection = await createCollection(trimmed);
      set((s) => ({ collections: [...s.collections, collection] }));
    } catch (e) {
      set({ error: messageOf(e) });
    }
  },

  removeCollection: async (id) => {
    try {
      await deleteCollection(id);
      set((s) => ({
        collections: s.collections.filter((c) => c.id !== id),
        selectedCollectionId: s.selectedCollectionId === id ? null : s.selectedCollectionId,
      }));
    } catch (e) {
      set({ error: messageOf(e) });
    }
  },

  toggleMembership: async (collectionId, bookId, member) => {
    try {
      await setCollectionMembership(collectionId, bookId, member);
      set((s) => ({
        collections: s.collections.map((c) => {
          if (c.id !== collectionId) return c;
          const bookIds = member
            ? [...new Set([...c.bookIds, bookId])]
            : c.bookIds.filter((id) => id !== bookId);
          return { ...c, bookIds };
        }),
      }));
    } catch (e) {
      set({ error: messageOf(e) });
    }
  },

  setProfileName: (name) => {
    const trimmed = name.trim() || "Guest library";
    localStorage.setItem(PROFILE_KEY, trimmed);
    set({ profileName: trimmed });
  },
}));

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
