import type {
  HighlightColorKey,
  ReadFont,
  ReadLayout,
  ReadTheme,
  TextAlign,
} from "../lib/types";
import type {
  RelocateDetail,
  RenderHighlight,
  SelectionDetail,
  TocItem,
} from "./types";

export interface ReaderPresentation {
  readTheme: ReadTheme;
  font: ReadFont;
  fontSize: number;
  lineHeight: number;
  measure: number;
  paragraphSpacing: number;
  align: TextAlign;
  layout: ReadLayout;
  highlightColors: Readonly<Record<HighlightColorKey, string>>;
}

export type ReaderDestination =
  | { kind: "target"; value: string }
  | { kind: "highlight"; value: string };

export type ReaderEvent =
  | { type: "relocate"; detail: RelocateDetail }
  | { type: "selection"; detail: SelectionDetail | null }
  | { type: "activity" };

export type ReaderListener = (event: ReaderEvent) => void;

export interface ReaderEngine {
  /** Open a book and display its requested position or first readable section. */
  open(bookId: string, initialTarget?: string | null): Promise<readonly TocItem[]>;
  navigate(destination: ReaderDestination): Promise<boolean>;
  turn(direction: "next" | "previous"): void;
  configure(presentation: ReaderPresentation): void;
  replaceHighlights(highlights: readonly RenderHighlight[], newId?: string): void;
  clearSelection(): void;
  subscribe(listener: ReaderListener): () => void;
  dispose(): void;
}
