import { invoke } from "@tauri-apps/api/core";

import type { Book, Collection, ReadingState, TocEntry, WeekStats } from "./types";

/** Typed wrappers over the Rust command surface. */

export interface ImportFailure {
  path: string;
  error: string;
}

export interface ImportSummary {
  imported: Book[];
  skipped: number;
  failed: ImportFailure[];
}

export function listBooks(): Promise<Book[]> {
  return invoke<Book[]>("list_books");
}

export function storageRoot(): Promise<string> {
  return invoke<string>("storage_root");
}

export function importBooks(paths: string[]): Promise<ImportSummary> {
  return invoke<ImportSummary>("import_books", { paths });
}

export function removeBook(id: string): Promise<void> {
  return invoke<void>("remove_book", { id });
}

export function bookToc(id: string): Promise<TocEntry[]> {
  return invoke<TocEntry[]>("book_toc", { id });
}

export function getReadingState(id: string): Promise<ReadingState | null> {
  return invoke<ReadingState | null>("get_reading_state", { id });
}

export function saveReadingState(
  id: string,
  locator: string | null,
  progress: number,
): Promise<void> {
  return invoke<void>("save_reading_state", { id, locator, progress });
}

export function listCollections(): Promise<Collection[]> {
  return invoke<Collection[]>("list_collections");
}

export function createCollection(name: string): Promise<Collection> {
  return invoke<Collection>("create_collection", { name });
}

export function deleteCollection(id: number): Promise<void> {
  return invoke<void>("delete_collection", { id });
}

export function setCollectionMembership(
  collectionId: number,
  bookId: string,
  member: boolean,
): Promise<void> {
  return invoke<void>("set_collection_membership", { collectionId, bookId, member });
}

export function logSession(
  bookId: string,
  startedAt: number,
  endedAt: number,
  pages: number,
): Promise<void> {
  return invoke<void>("log_session", { bookId, startedAt, endedAt, pages });
}

export function weekStats(): Promise<WeekStats> {
  return invoke<WeekStats>("week_stats");
}
