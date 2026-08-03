import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";

import {
  createCollection,
  deleteCollection,
  importBooks,
  insightsData,
  listBooks,
  listCollections,
  removeBook,
  saveReadingState,
  setCollectionMembership,
  storageRoot,
} from "../lib/ipc";
import { messageOf } from "../lib/errors";
import { isDesktop } from "../lib/platform";
import type { Book, Collection, InsightsData, View } from "../lib/types";

export interface AppNotice {
  text: string;
  tone: "error" | "success";
  persistent: boolean;
}

interface LibraryState {
  view: View;
  aboutOpen: boolean;
  aboutHighlightSince: string | null;
  activeBookId: string | null;
  pendingLocator: string | null;
  books: Book[];
  collections: Collection[];
  selectedCollectionId: number | null;
  insights: InsightsData | null;
  insightsLoading: boolean;
  storageRoot: string;
  loading: boolean;
  importing: boolean;
  error: string | null;
  appNotice: AppNotice | null;

  openAbout: (highlightSince?: string | null) => void;
  closeAbout: () => void;
  openReader: (id: string, locator?: string | null) => void;
  consumePendingLocator: () => string | null;
  goLibrary: () => void;
  openInsights: () => Promise<void>;
  loadLibrary: () => Promise<void>;
  pickAndImport: () => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
  removeBookById: (id: string) => Promise<void>;
  resetProgress: (id: string) => Promise<void>;
  clearError: () => void;
  showAppNotice: (notice: AppNotice) => void;
  clearAppNotice: () => void;

  selectCollection: (id: number | null) => void;
  addCollection: (name: string) => Promise<void>;
  removeCollection: (id: number) => Promise<void>;
  toggleMembership: (collectionId: number, bookId: string, member: boolean) => Promise<void>;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  view: "library",
  aboutOpen: false,
  aboutHighlightSince: null,
  activeBookId: null,
  pendingLocator: null,
  books: [],
  collections: [],
  selectedCollectionId: null,
  insights: null,
  insightsLoading: false,
  storageRoot: "",
  loading: true,
  importing: false,
  error: null,
  appNotice: null,

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

  openInsights: async () => {
    set({ view: "insights", insightsLoading: true });
    try {
      const insights = await insightsData();
      set({ insights, insightsLoading: false });
    } catch (e) {
      set({
        error: messageOf(e),
        insightsLoading: false,
        view: "library",
      });
    }
  },

  loadLibrary: async () => {
    set({ loading: get().books.length === 0, error: null });
    try {
      const [books, root, collections] = await Promise.all([
        listBooks(),
        get().storageRoot ? Promise.resolve(get().storageRoot) : storageRoot(),
        listCollections(),
      ]);
      const selectedCollectionId = collections.some(
        (c) => c.id === get().selectedCollectionId,
      )
        ? get().selectedCollectionId
        : null;
      set({ books, storageRoot: root, collections, selectedCollectionId, loading: false });
    } catch (e) {
      set({ error: messageOf(e), loading: false });
    }
  },

  pickAndImport: async () => {
    if (!isDesktop) return;
    const selection = await open({
      multiple: true,
      filters: [{ name: "Books", extensions: ["epub"] }],
    });
    if (!selection) return;
    const paths = Array.isArray(selection) ? selection : [selection];
    await get().importPaths(paths);
  },

  importPaths: async (paths) => {
    if (!isDesktop || paths.length === 0) return;
    set({ importing: true, error: null });
    try {
      const summary = await importBooks(paths);
      const books = await listBooks();
      const error =
        summary.failed.length > 0
          ? summary.failed.length === 1
            ? "Novus could not import one file."
            : `Novus could not import ${summary.failed.length} files.`
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

  resetProgress: async (id) => {
    try {
      await saveReadingState(id, null, 0);
      set((s) => ({
        books: s.books.map((b) => (b.id === id ? { ...b, progress: 0 } : b)),
      }));
    } catch (e) {
      set({ error: messageOf(e) });
    }
  },

  clearError: () => set({ error: null }),
  showAppNotice: (notice) => set({ appNotice: notice }),
  clearAppNotice: () => set({ appNotice: null }),

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
}));
