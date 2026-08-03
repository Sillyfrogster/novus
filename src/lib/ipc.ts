import { invoke } from "@tauri-apps/api/core";

import type { TocItem } from "../reader/types";
import type {
  Book,
  Collection,
  Highlight,
  HighlightColorKey,
  InsightsData,
} from "./types";

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

export function bookToc(id: string): Promise<TocItem[]> {
  return invoke<TocItem[]>("book_toc", { id });
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

export interface SessionRecord {
  uuid: string;
  bookId: string;
  startedAt: number;
  endedAt: number;
  activeSeconds: number;
  pagesRead: number;
  medianPageMs: number;
  startFraction: number;
  endFraction: number;
}

export function recordSession(session: SessionRecord): Promise<void> {
  return invoke<void>("record_session", { ...session });
}

export interface DiscordPresence {
  title: string;
  chapter: string;
  currentPage: number | null;
  totalPages: number | null;
  progress: number;
  startedAt: number;
}

export function setDiscordPresence(presence: DiscordPresence): Promise<void> {
  return invoke<void>("set_discord_presence", { ...presence });
}

export function clearDiscordPresence(): Promise<void> {
  return invoke<void>("clear_discord_presence");
}

export function insightsData(): Promise<InsightsData> {
  return invoke<InsightsData>("insights_data");
}

// highlights

export interface NewHighlight {
  id: string;
  bookId: string;
  cfi: string;
  text: string;
  chapterLabel: string | null;
  chapterHref: string | null;
  sectionIndex: number;
  location: number | null;
  color: HighlightColorKey;
  note: string | null;
}

export function listHighlights(bookId: string): Promise<Highlight[]> {
  return invoke<Highlight[]>("list_highlights", { bookId });
}

export function addHighlight(h: NewHighlight): Promise<Highlight> {
  return invoke<Highlight>("add_highlight", { ...h });
}

export function setHighlightNote(id: string, note: string | null): Promise<void> {
  return invoke<void>("set_highlight_note", { id, note });
}

export function deleteHighlight(id: string): Promise<void> {
  return invoke<void>("delete_highlight", { id });
}

export function writeFile(path: string, contents: Uint8Array): Promise<void> {
  return invoke<void>("write_file", { path, contents: Array.from(contents) });
}
