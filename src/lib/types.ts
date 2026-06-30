/** A book in the library. Mirrors the Rust `Book` struct. */
export interface Book {
  id: string;
  title: string;
  author: string;
  format: string;
  relPath: string;
  coverPath: string | null;
  pageCount: number | null;
  language: string | null;
  description: string | null;
  fileSize: number;
  addedAt: number;
  progress: number;
}

/** One entry in a book's table of contents, flattened with a nesting depth. */
export interface TocEntry {
  label: string;
  depth: number;
  href: string;
}

export interface ReadingState {
  locator: string | null;
  progress: number;
  lastReadAt: number | null;
}

export interface Collection {
  id: number;
  name: string;
  bookIds: string[];
}

/** The fixed set of highlight color slots. */
export type HighlightColorKey = "slate" | "sage" | "violet" | "rose";

/** A highlighted passage. Mirrors the backend `Highlight` struct. */
export interface Highlight {
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
  createdAt: number;
}

export interface WeekStats {
  streakDays: number;
  seconds: number;
  pages: number;
}

export type AppTheme = "light" | "dark";
export type ReadTheme = "light" | "sepia" | "dark";
export type ReadFont = "serif" | "sans" | "modern";
export type ReadLayout = "paged" | "scroll";
export type TextAlign = "left" | "justify";
export type View = "library" | "reader";
