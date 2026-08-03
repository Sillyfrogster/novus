import { describe, expect, test } from "bun:test";

import {
  createHighlightsStore,
  type HighlightsBackend,
} from "../src/store/highlights";
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
    setNote: async () => {},
    remove: async () => {},
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
});
