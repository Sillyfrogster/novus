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
}

export interface LoadDetail {
  doc: Document;
  index: number;
}

export type Flow = "paginated" | "scrolled";

export interface ReaderSurface {
  open(file: File): Promise<void>;
  goTo(target: string): Promise<boolean>;
  next(): void;
  prev(): void;
  setFlow(flow: Flow): void;
  setStyles(css: string): void;
  resetPosition(): Promise<void>;
  readonly toc: TocItem[];
  destroy(): void;
  on(type: "relocate", cb: (detail: RelocateDetail) => void): void;
  on(type: "load", cb: (detail: LoadDetail) => void): void;
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
