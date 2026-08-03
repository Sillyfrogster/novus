import { create } from "zustand";

import {
  addHighlight,
  deleteHighlight,
  listHighlights,
  setHighlightNote,
  type NewHighlight,
} from "../lib/ipc";
import type { Highlight, HighlightColorKey } from "../lib/types";

export interface CaptureInput {
  id?: string;
  bookId: string;
  cfi: string;
  text: string;
  chapterLabel: string | null;
  chapterHref: string | null;
  sectionIndex: number;
  location: number | null;
  color: HighlightColorKey;
}

interface HighlightGroup {
  label: string;
  items: Highlight[];
}

export interface HighlightsBackend {
  list: (bookId: string) => Promise<Highlight[]>;
  add: (highlight: NewHighlight) => Promise<Highlight>;
  setNote: (id: string, note: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

interface HighlightStore {
  bookId: string | null;
  highlights: Highlight[];
  status: "idle" | "loading" | "ready" | "error";
  loadFor: (bookId: string) => Promise<void>;
  capture: (input: CaptureInput) => Promise<Highlight | null>;
  updateNote: (id: string, note: string | null) => Promise<void>;
  remove: (id: string) => Promise<Highlight | null>;
  restore: (highlight: Highlight) => Promise<boolean>;
}

const tauriBackend: HighlightsBackend = {
  list: listHighlights,
  add: addHighlight,
  setNote: setHighlightNote,
  remove: deleteHighlight,
};

function order(highlights: Highlight[]): Highlight[] {
  return [...highlights].sort((a, b) => {
    if (a.sectionIndex !== b.sectionIndex) return a.sectionIndex - b.sectionIndex;
    const location = (a.location ?? Number.MAX_SAFE_INTEGER) -
      (b.location ?? Number.MAX_SAFE_INTEGER);
    return location || a.createdAt - b.createdAt;
  });
}

export function createHighlightsStore(backend: HighlightsBackend) {
  let loadSequence = 0;
  let readyBook: string | null = null;
  let pendingLoad: { bookId: string; promise: Promise<void> } | null = null;
  let backendQueue = Promise.resolve();

  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = backendQueue.then(operation);
    backendQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return create<HighlightStore>((set, get) => {
    const change = (
      bookId: string,
      update: (highlights: Highlight[]) => Highlight[],
      reorder = false,
    ) => {
      set((state) => {
        if (state.bookId !== bookId) return state;
        const highlights = update(state.highlights);
        return { highlights: reorder ? order(highlights) : highlights };
      });
    };

    const loadFor = (bookId: string): Promise<void> => {
      const state = get();
      if (pendingLoad?.bookId === bookId) return pendingLoad.promise;
      const sequence = ++loadSequence;
      if (state.bookId !== bookId) readyBook = null;
      set((current) =>
        current.bookId === bookId
          ? { status: "loading" }
          : { bookId, highlights: [], status: "loading" },
      );
      const promise = run(() => backend.list(bookId))
        .then((highlights) => {
          if (sequence === loadSequence && get().bookId === bookId) {
            readyBook = bookId;
            set({ highlights: order(highlights), status: "ready" });
          }
        })
        .catch(() => {
          if (sequence === loadSequence && get().bookId === bookId) {
            set({ status: "error" });
          }
        })
        .finally(() => {
          if (sequence === loadSequence) pendingLoad = null;
        });
      pendingLoad = { bookId, promise };
      return promise;
    };

    const readyFor = async (bookId: string): Promise<boolean> => {
      if (get().bookId !== bookId) await loadFor(bookId);
      else if (pendingLoad?.bookId === bookId) await pendingLoad.promise;
      return get().bookId === bookId && readyBook === bookId;
    };

    return {
      bookId: null,
      highlights: [],
      status: "idle",
      loadFor,

      capture: async ({ id: providedId, ...input }) => {
        if (!(await readyFor(input.bookId))) return null;
        const id = providedId ?? crypto.randomUUID();
        const payload: NewHighlight = { id, note: null, ...input };
        try {
          const saved = await run(() => backend.add(payload));
          change(
            input.bookId,
            (highlights) => [...highlights, saved],
            true,
          );
          return saved;
        } catch {
          return null;
        }
      },

      updateNote: async (id, note) => {
        const bookId = get().bookId;
        if (!bookId || !(await readyFor(bookId))) return;
        if (!get().highlights.some((highlight) => highlight.id === id)) return;
        const clean = note?.trim() || null;
        try {
          await run(() => backend.setNote(id, clean));
          change(bookId, (highlights) =>
            highlights.map((highlight) =>
              highlight.id === id ? { ...highlight, note: clean } : highlight,
            ),
          );
        } catch {
          // The visible note remains at its durable value.
        }
      },

      remove: async (id) => {
        const bookId = get().bookId;
        if (!bookId || !(await readyFor(bookId))) return null;
        const removed = get().highlights.find((highlight) => highlight.id === id) ?? null;
        if (!removed) return null;
        try {
          await run(() => backend.remove(id));
          change(bookId, (highlights) =>
            highlights.filter((highlight) => highlight.id !== id),
          );
          return removed;
        } catch {
          return null;
        }
      },

      restore: async (highlight) => {
        if (!(await readyFor(highlight.bookId))) return false;
        if (get().highlights.some((item) => item.id === highlight.id)) return true;
        const { createdAt: _, ...payload } = highlight;
        try {
          const saved = await run(() => backend.add(payload));
          change(highlight.bookId, (highlights) => [...highlights, saved], true);
          return true;
        } catch {
          return false;
        }
      },
    };
  });
}

export const useHighlights = createHighlightsStore(tauriBackend);

let groupCache: { highlights: Highlight[]; groups: HighlightGroup[] } | null = null;

export function useHighlightGroups(): HighlightGroup[] {
  return useHighlights((state) => {
    if (groupCache?.highlights === state.highlights) return groupCache.groups;
    const groups: HighlightGroup[] = [];
    for (const highlight of state.highlights) {
      const label = highlight.chapterLabel?.trim() || "Unlabeled";
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push(highlight);
      else groups.push({ label, items: [highlight] });
    }
    groupCache = { highlights: state.highlights, groups };
    return groups;
  });
}
