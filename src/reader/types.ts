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

export type SectionSource = string;

export interface BookSection {
  id: string | number;
  linear?: string;
  size: number;
  cfi?: string;
  load(): Promise<SectionSource> | SectionSource;
  unload?(): void;
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
  resolveCFI?(cfi: string): ResolvedTarget & { anchor: (doc: Document) => Range | Node };
  resolveHref(href: string): ResolvedTarget | Promise<ResolvedTarget>;
  splitTOCHref(
    href: string | undefined,
  ): Promise<[string, string | null]> | [string, string | null];
  getTOCFragment(doc: Document, id: string | null): Node | null;
  isExternal?(uri: string): boolean;
  destroy?(): void;
}
