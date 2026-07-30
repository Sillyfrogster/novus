import type {
  ReaderDestination,
  ReaderEvent,
  ReaderListener,
  ReaderPresentation,
  ReaderSession,
} from "../../src/reader/contract";
import type { RenderHighlight, TocItem } from "../../src/reader/types";

export class MemoryReaderSession implements ReaderSession {
  readonly destinations: ReaderDestination[] = [];
  readonly turns: ("next" | "previous")[] = [];
  presentation: ReaderPresentation | null = null;
  highlights: readonly RenderHighlight[] = [];
  emphasizedHighlight: string | undefined;
  disposed = false;

  readonly #contents: readonly TocItem[];
  readonly #listeners = new Set<ReaderListener>();

  constructor(contents: readonly TocItem[] = []) {
    this.#contents = contents;
  }

  async open(_bookId: string): Promise<readonly TocItem[]> {
    if (this.disposed) throw new Error("Reader is closed");
    return this.#contents;
  }

  async navigate(destination: ReaderDestination): Promise<boolean> {
    if (this.disposed) return false;
    this.destinations.push(destination);
    return destination.kind === "start" || destination.value !== "missing.xhtml";
  }

  turn(direction: "next" | "previous"): void {
    if (!this.disposed) this.turns.push(direction);
  }

  configure(presentation: ReaderPresentation): void {
    if (!this.disposed) this.presentation = presentation;
  }

  replaceHighlights(
    highlights: readonly RenderHighlight[],
    newId?: string,
  ): void {
    if (this.disposed) return;
    this.highlights = highlights;
    this.emphasizedHighlight = newId;
  }

  clearSelection(): void {
    this.emit({ type: "selection", detail: null });
  }

  subscribe(listener: ReaderListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.#listeners.clear();
  }

  emit(event: ReaderEvent): void {
    if (this.disposed) return;
    for (const listener of this.#listeners) listener(event);
  }
}
