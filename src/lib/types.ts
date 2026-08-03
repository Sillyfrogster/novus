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

/** One local calendar day of reading activity. */
export interface DailyActivity {
  day: string;
  activeSeconds: number;
  pagesRead: number;
  sessions: number;
}

/** Total time a book has actually been read. */
export interface BookTime {
  bookId: string;
  title: string;
  author: string;
  activeSeconds: number;
  pagesRead: number;
}

/** Personal-pace estimate of the reading time left in an in-progress book. */
export interface FinishEstimate {
  bookId: string;
  title: string;
  progress: number;
  secondsLeft: number;
}

/** Everything the insights page renders. */
export interface InsightsData {
  finishedCount: number;
  readingCount: number;
  unreadCount: number;
  streakDays: number;
  activeSeconds30d: number;
  pagesRead30d: number;
  sessionCount30d: number;
  avgSessionSeconds30d: number;
  medianPageSeconds: number;
  pagesPerHour: number;
  daily: DailyActivity[];
  bookTimes: BookTime[];
  finishEstimates: FinishEstimate[];
}

export type AppTheme = "light" | "dark";
export type ReadTheme = "light" | "sepia" | "dark";
export type ReadFont = "serif" | "sans" | "modern";
export type ReadLayout = "paged" | "scroll";
export type TextAlign = "left" | "justify";
export type View = "library" | "reader" | "insights";
