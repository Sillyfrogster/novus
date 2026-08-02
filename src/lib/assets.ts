import { convertFileSrc } from "@tauri-apps/api/core";

import type { Book } from "./types";

let coverRevision = 0;

export function refreshCoverUrls(): void {
  coverRevision += 1;
}

/** Webview-loadable URL for a book's cover, or null if it has none / fails. */
export function coverUrl(book: Book, storageRoot: string): string | null {
  if (!book.coverPath || !storageRoot) return null;
  try {
    const url = convertFileSrc(`${storageRoot}/${book.coverPath}`);
    return coverRevision === 0 ? url : `${url}?novus-cover=${coverRevision}`;
  } catch {
    return null;
  }
}

/** Webview-loadable URL for a book's managed file (used by the reader). */
export function bookUrl(book: Book, storageRoot: string): string | null {
  if (!storageRoot) return null;
  try {
    return convertFileSrc(`${storageRoot}/${book.relPath}`);
  } catch {
    return null;
  }
}
