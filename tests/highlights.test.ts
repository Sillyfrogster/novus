import { describe, expect, test } from "bun:test";

import { createHighlightsStore, type HighlightsBackend } from "../src/store/highlights";
import type { NewHighlight } from "../src/lib/ipc";
import type { Highlight } from "../src/lib/types";

function highlight(id: string, bookId: string): Highlight {
  return {
    id,
    bookId,
    cfi: `epubcfi(/6/${id})`,
    text: `Passage ${id}`,
    chapterLabel: "Chapter one",
    chapterHref: "chapter.xhtml",
    sectionIndex: 0,
    location: 0,
    color: "slate",
    note: null,
    createdAt: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function memoryBackend(
  list: HighlightsBackend["list"],
  overrides: Partial<HighlightsBackend> = {},
): HighlightsBackend {
  return {
    list,
    add: async (input) => ({ ...input, createdAt: 1 }),
    setNote: async () => undefined,
    remove: async () => undefined,
    ...overrides,
  };
}

describe("highlight transactions", () => {
  test("serializes edits and isolates a failed mutation from the next book", async () => {
    const firstEdit = deferred<void>();
    const firstEditStarted = deferred<void>();
    const removal = deferred<void>();
    const removalStarted = deferred<void>();
    let noteWrites = 0;
    const backend = memoryBackend(
      async (bookId) => [highlight(bookId === "a" ? "a1" : "b1", bookId)],
      {
        setNote: async () => {
          noteWrites += 1;
          if (noteWrites === 1) {
            firstEditStarted.resolve();
            await firstEdit.promise;
          }
        },
        remove: async () => {
          removalStarted.resolve();
          await removal.promise;
        },
      },
    );
    const store = createHighlightsStore(backend);
    await store.getState().loadFor("a");

    const older = store.getState().updateNote("a1", "older");
    await firstEditStarted.promise;
    const newer = store.getState().updateNote("a1", "newer");
    firstEdit.reject(new Error("write failed"));
    await Promise.all([older, newer]);

    expect(noteWrites).toBe(2);
    expect(store.getState().highlights[0]?.note).toBe("newer");

    const removing = store.getState().remove("a1");
    await removalStarted.promise;
    const loadingNextBook = store.getState().loadFor("b");
    removal.reject(new Error("delete failed"));
    await loadingNextBook;
    expect(await removing).toBeNull();
    expect(store.getState().bookId).toBe("b");
    expect(store.getState().highlights.map(({ id }) => id)).toEqual(["b1"]);
  });

  test("reports a reload failure without discarding known highlights", async () => {
    let fail = false;
    const saved = highlight("a1", "a");
    const store = createHighlightsStore(
      memoryBackend(async () => {
        if (fail) throw new Error("database unavailable");
        return [saved];
      }),
    );

    await store.getState().loadFor("a");
    fail = true;
    await store.getState().loadFor("a");

    expect(store.getState().status).toBe("error");
    expect(store.getState().highlights).toEqual([saved]);
  });

  test("saves a trimmed note through the backend and shows it in state", async () => {
    const notes: Array<[string, string | null]> = [];
    const store = createHighlightsStore(
      memoryBackend(async (bookId) => [highlight("a1", bookId)], {
        setNote: async (id, note) => {
          notes.push([id, note]);
        },
      }),
    );
    await store.getState().loadFor("a");

    await store.getState().updateNote("a1", "  quiet passage  ");

    expect(notes).toEqual([["a1", "quiet passage"]]);
    expect(store.getState().highlights[0]?.note).toBe("quiet passage");
  });

  test("stores a whitespace-only note as null", async () => {
    const notes: Array<[string, string | null]> = [];
    const store = createHighlightsStore(
      memoryBackend(async (bookId) => [highlight("a1", bookId)], {
        setNote: async (id, note) => {
          notes.push([id, note]);
        },
      }),
    );
    await store.getState().loadFor("a");
    await store.getState().updateNote("a1", "kept for now");

    await store.getState().updateNote("a1", "   ");

    expect(notes).toEqual([
      ["a1", "kept for now"],
      ["a1", null],
    ]);
    expect(store.getState().highlights[0]?.note).toBeNull();
  });

  test("deletes a highlight, removes its row, and returns the removed highlight", async () => {
    const deleted: string[] = [];
    const store = createHighlightsStore(
      memoryBackend(async (bookId) => [highlight("a1", bookId), highlight("a2", bookId)], {
        remove: async (id) => {
          deleted.push(id);
        },
      }),
    );
    await store.getState().loadFor("a");

    const removed = await store.getState().remove("a1");

    expect(deleted).toEqual(["a1"]);
    expect(removed).toEqual(highlight("a1", "a"));
    expect(store.getState().highlights.map(({ id }) => id)).toEqual(["a2"]);
  });

  /** This failure is silent today. */
  test("keeps the row and returns null when the backend delete fails", async () => {
    const store = createHighlightsStore(
      memoryBackend(async (bookId) => [highlight("a1", bookId)], {
        remove: async () => {
          throw new Error("delete failed");
        },
      }),
    );
    await store.getState().loadFor("a");

    expect(await store.getState().remove("a1")).toBeNull();
    expect(store.getState().highlights.map(({ id }) => id)).toEqual(["a1"]);
  });

  /** This failure is silent today. */
  test("keeps the previous durable note when the backend note write fails", async () => {
    const store = createHighlightsStore(
      memoryBackend(async (bookId) => [{ ...highlight("a1", bookId), note: "durable" }], {
        setNote: async () => {
          throw new Error("write failed");
        },
      }),
    );
    await store.getState().loadFor("a");

    await store.getState().updateNote("a1", "edited");

    expect(store.getState().highlights[0]?.note).toBe("durable");
  });

  test("restores a deleted highlight with its original fields and id", async () => {
    const sent: Array<Omit<Highlight, "createdAt">> = [];
    const original = highlight("a1", "a");
    const store = createHighlightsStore(
      memoryBackend(async () => [original], {
        add: async (input: NewHighlight) => {
          sent.push(input);
          return { ...input, createdAt: 1 };
        },
      }),
    );
    await store.getState().loadFor("a");
    await store.getState().remove("a1");

    const restored = await store.getState().restore(original);

    const { createdAt: _createdAt, ...fields } = original;
    expect(restored).toBe(true);
    expect(sent).toEqual([fields]);
    expect(store.getState().highlights.map(({ id }) => id)).toEqual(["a1"]);
  });

  /** This failure is silent today. */
  test("returns false and leaves the row absent when the backend restore fails", async () => {
    const original = highlight("a1", "a");
    const store = createHighlightsStore(
      memoryBackend(async () => [original], {
        add: async () => {
          throw new Error("restore failed");
        },
      }),
    );
    await store.getState().loadFor("a");
    await store.getState().remove("a1");

    expect(await store.getState().restore(original)).toBe(false);
    expect(store.getState().highlights).toEqual([]);
  });

  test("captures a highlight with the explicit id and stores the saved row", async () => {
    const sent: NewHighlight[] = [];
    const saved: Highlight = { ...highlight("new1", "a"), createdAt: 42 };
    const store = createHighlightsStore(
      memoryBackend(async () => [], {
        add: async (input) => {
          sent.push(input);
          return saved;
        },
      }),
    );
    await store.getState().loadFor("a");

    const result = await store.getState().capture({
      id: "new1",
      bookId: "a",
      cfi: "epubcfi(/6/new1)",
      text: "Passage new1",
      chapterLabel: "Chapter one",
      chapterHref: "chapter.xhtml",
      sectionIndex: 0,
      location: 0,
      color: "slate",
    });

    expect(sent).toEqual([
      {
        id: "new1",
        note: null,
        bookId: "a",
        cfi: "epubcfi(/6/new1)",
        text: "Passage new1",
        chapterLabel: "Chapter one",
        chapterHref: "chapter.xhtml",
        sectionIndex: 0,
        location: 0,
        color: "slate",
      },
    ]);
    expect(result).toEqual(saved);
    expect(store.getState().highlights).toEqual([saved]);
  });

  /** This failure is silent today. */
  test("returns null and leaves state unchanged when the backend capture fails", async () => {
    const existing = highlight("a1", "a");
    const store = createHighlightsStore(
      memoryBackend(async () => [existing], {
        add: async () => {
          throw new Error("capture failed");
        },
      }),
    );
    await store.getState().loadFor("a");

    const result = await store.getState().capture({
      id: "new1",
      bookId: "a",
      cfi: "epubcfi(/6/new1)",
      text: "Passage new1",
      chapterLabel: "Chapter one",
      chapterHref: "chapter.xhtml",
      sectionIndex: 0,
      location: 0,
      color: "slate",
    });

    expect(result).toBeNull();
    expect(store.getState().highlights).toEqual([existing]);
  });
});
