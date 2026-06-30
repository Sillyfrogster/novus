declare module "*/foliate-js/progress.js" {
  export class SectionProgress {
    constructor(
      sections: { linear?: string; size: number }[],
      sizePerLoc: number,
      sizePerTimeUnit: number,
    );
    sectionFractions: number[];
    getProgress(
      index: number,
      fractionInSection: number,
      pageFraction?: number,
    ): { fraction: number; section: { current: number; total: number } };
    getSection(fraction: number): [number, number];
  }
  export class TOCProgress {
    init(opts: {
      toc: unknown[];
      ids: string[];
      splitHref: (href: string | undefined) => Promise<[string, string | null]> | [string, string | null];
      getFragment: (doc: Document, id: string | null) => Node | null;
    }): Promise<void>;
    getProgress(index: number, range?: Range): { label?: string } | null | undefined;
  }
}

declare module "*/foliate-js/epubcfi.js" {
  export const isCFI: RegExp;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function parse(cfi: string): any;
  export function fromRange(range: Range, filter?: unknown): string;
  export function toRange(doc: Document, parts: unknown, filter?: unknown): Range;
  export function joinIndir(...xs: string[]): string;
  export function collapse(x: string, toEnd?: boolean): string;
  export function compare(a: string, b: string): number;
  export const fake: {
    fromIndex(index: number): string;
    toIndex(part: unknown): number;
  };
}

declare module "*/foliate-js/epub.js" {
  export class EPUB {
    constructor(loader: unknown);
    init(): Promise<unknown>;
  }
}

declare module "*/foliate-js/vendor/zip.js" {
  export interface ZipEntry {
    filename: string;
    uncompressedSize: number;
    getData(writer: unknown): Promise<unknown>;
  }
  export function configure(opts: { useWebWorkers?: boolean }): void;
  export class ZipReader {
    constructor(reader: unknown);
    getEntries(): Promise<ZipEntry[]>;
  }
  export class BlobReader {
    constructor(blob: Blob);
  }
  export class TextWriter {}
  export class BlobWriter {
    constructor(type?: string);
  }
}
