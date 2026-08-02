import { expect, mock, test } from "bun:test";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    setItem: () => {},
  },
});

let finishRefresh: (() => void) | null = null;
const refresh = new Promise<void>((resolve) => {
  finishRefresh = resolve;
});

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command === "list_books") {
      await refresh;
      return [];
    }
    if (command === "list_collections") return [];
    return null;
  },
}));

mock.module("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));

const { useLibrary } = await import("../src/store/library");

test("returning from the reader keeps the populated library visible", () => {
  useLibrary.setState({
    activeBookId: "book-1",
    books: [
      {
        id: "book-1",
        title: "The Book",
        author: "Novus",
        format: "epub",
        relPath: "books/book-1.epub",
        coverPath: "covers/book-1.jpg",
        pageCount: 240,
        language: "en",
        description: null,
        fileSize: 1024,
        addedAt: 1,
        progress: 0.4,
        lastReadAt: 1,
      },
    ],
    collections: [],
    loading: false,
    storageRoot: "/library",
    view: "reader",
  });

  useLibrary.getState().goLibrary();

  expect(useLibrary.getState().view).toBe("library");
  expect(useLibrary.getState().loading).toBe(false);
  expect(useLibrary.getState().books).toHaveLength(1);
  finishRefresh?.();
});
