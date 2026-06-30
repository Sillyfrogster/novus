/**
 * The renderer port.
 */

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

export interface RelocateDetail {
  fraction: number;
  cfi: string | null;
  tocItem?: { label?: string } | null;
  location?: { current: number; total: number } | null;
}

export interface LoadDetail {
  doc: Document;
  index: number;
}

/** A finalized text selection inside the book. */
export interface SelectionDetail {
  text: string;
  cfi: string | null;
  sectionIndex: number;
  rect: { top: number; bottom: number; left: number; right: number };
}

/** The minimum a highlight needs to be drawn. */
export interface RenderHighlight {
  id: string;
  cfi: string;
  color: string;
  sectionIndex: number;
}

export type Flow = "paginated" | "scrolled";

export interface ReaderSurface {
  open(file: File): Promise<void>;
  goTo(target: string): Promise<boolean>;
  next(): void;
  prev(): void;
  setFlow(flow: Flow): void;
  setMaxInlineSize(px: number): void;
  setStyles(css: string): void;
  resetPosition(): Promise<void>;
  setHighlights(highlights: RenderHighlight[], newId?: string): void;
  goToHighlight(cfi: string): Promise<boolean>;
  clearSelection(): void;
  readonly toc: TocItem[];
  destroy(): void;
  on(type: "relocate", cb: (detail: RelocateDetail) => void): void;
  on(type: "load", cb: (detail: LoadDetail) => void): void;
  on(type: "selection", cb: (detail: SelectionDetail | null) => void): void;
}

export interface EpubSection {
  id: string;
  linear?: string;
  size: number;
  cfi?: string;
  load(): Promise<string> | string;
  unload?(): void;
  createDocument(): Promise<Document>;
  resolveHref?(href: string): string;
}

export interface EpubBook {
  sections: EpubSection[];
  toc?: TocItem[];
  pageList?: TocItem[];
  metadata?: { language?: string | string[] };
  dir?: string;
  rendition?: { layout?: string };
  resolveCFI?(cfi: string): { index: number; anchor: (doc: Document) => Range | Node };
  resolveHref(href: string): { index: number; anchor: (doc: Document) => Range | Node };
  splitTOCHref(href: string | undefined): Promise<[string, string | null]> | [string, string | null];
  getTOCFragment(doc: Document, id: string | null): Node | null;
  isExternal?(uri: string): boolean;
}
