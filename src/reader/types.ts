/**
 * The renderer port.
 */

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

export type RelocateReason = "page" | "scroll" | "jump" | "layout";

export interface RelocateDetail {
  fraction: number;
  cfi: string | null;
  tocItem?: { label?: string } | null;
  location?: { current: number; total: number } | null;
  reason: RelocateReason;
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
  off(type: "relocate", cb: (detail: RelocateDetail) => void): void;
  off(type: "load", cb: (detail: LoadDetail) => void): void;
  off(type: "selection", cb: (detail: SelectionDetail | null) => void): void;
}

export type SectionSource = string;

export interface BookSection {
  id: string | number;
  linear?: string;
  size: number;
  cfi?: string;
  load(): Promise<SectionSource> | SectionSource;
  unload?(): void;
  createDocument?(): Promise<Document>;
  resolveHref?(href: string): string;
}

/** A resolved in-book target. */
export interface ResolvedTarget {
  index: number;
  anchor?: (doc: Document) => Range | Node;
}

export interface BookModel {
  sections: BookSection[];
  toc?: TocItem[];
  pageList?: TocItem[];
  metadata?: {
    language?: string | string[];
    title?: unknown;
    author?: unknown;
    description?: unknown;
  };
  dir?: string;
  resolveCFI?(cfi: string): ResolvedTarget & { anchor: (doc: Document) => Range | Node };
  resolveHref(href: string): ResolvedTarget | Promise<ResolvedTarget>;
  splitTOCHref(
    href: string | undefined,
  ): Promise<[string, string | null]> | [string, string | null];
  getTOCFragment(doc: Document, id: string | null): Node | null;
  isExternal?(uri: string): boolean;
  getCover?(): Promise<Blob | null>;
  destroy?(): void;
}
