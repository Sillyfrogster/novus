/**
 * NovusRenderer.
 */
import { getVisibleRange, uncollapse, type RectMapper } from "./geometry";
import type {
  EpubBook,
  EpubSection,
  Flow,
  LoadDetail,
  ReaderSurface,
  RelocateDetail,
  TocItem,
} from "./types";

type ScrollReason = "anchor" | "navigation" | "page" | "scroll" | "resize";

const setStylesImportant = (el: HTMLElement, styles: Record<string, string>) => {
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v, "important");
};

const getDirection = (doc: Document) => {
  const { direction } = doc.defaultView!.getComputedStyle(doc.body);
  const rtl =
    doc.body.dir === "rtl" || direction === "rtl" || doc.documentElement.dir === "rtl";
  return { rtl };
};

const getBackground = (doc: Document): string => {
  const body = doc.defaultView!.getComputedStyle(doc.body);
  return body.backgroundColor === "rgba(0, 0, 0, 0)" && body.backgroundImage === "none"
    ? doc.defaultView!.getComputedStyle(doc.documentElement).background
    : body.background;
};

interface Layout {
  flow: Flow;
  width: number;
  height: number;
  gap: number;
  columnWidth: number;
  margin: number;
}

const ELEMENT_STYLE: Partial<CSSStyleDeclaration> = {
  boxSizing: "content-box",
  position: "relative",
  overflow: "hidden",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  width: "100%",
  height: "100%",
};
const IFRAME_STYLE: Partial<CSSStyleDeclaration> = {
  overflow: "hidden",
  border: "0",
  display: "none",
  width: "100%",
  height: "100%",
};

export class NovusRenderer implements ReaderSurface {
  maxInlineSize = 720;
  maxColumnCount = 2;
  gapPercent = 0.07;
  scrollMargin = 48;

  #host: HTMLElement;
  #container: HTMLDivElement;
  #element: HTMLDivElement;
  #iframe!: HTMLIFrameElement;
  #contentRange = document.createRange();

  #book: EpubBook | null = null;
  #sections: EpubSection[] = [];
  #sectionProgress: import("../../vendor/foliate-js/progress.js").SectionProgress | null = null;
  #tocProgress: import("../../vendor/foliate-js/progress.js").TOCProgress | null = null;
  #cfi: typeof import("../../vendor/foliate-js/epubcfi.js") | null = null;
  #toc: TocItem[] = [];

  #flow: Flow = "paginated";
  #styles = "";
  #styleEl: HTMLStyleElement | null = null;
  #index = -1;
  #anchor: number | Range | Node = 0;
  #rtl = false;
  #size = 0;
  #margin = 0;
  #locked = false;

  #observer: ResizeObserver;
  #relocateCb: ((d: RelocateDetail) => void) | null = null;
  #loadCb: ((d: LoadDetail) => void) | null = null;

  constructor(host: HTMLElement) {
    this.#host = host;
    this.#container = document.createElement("div");
    this.#element = document.createElement("div");

    Object.assign(this.#container.style, {
      boxSizing: "border-box",
      position: "relative",
      width: "100%",
      height: "100%",
      overflow: "hidden",
    });
    Object.assign(this.#element.style, ELEMENT_STYLE);
    this.#container.append(this.#element);
    this.#host.append(this.#container);

    this.#observer = new ResizeObserver(() => this.#render("resize"));
    this.#observer.observe(this.#container);
  }

  get toc(): TocItem[] {
    return this.#toc;
  }

  on(type: "relocate", cb: (d: RelocateDetail) => void): void;
  on(type: "load", cb: (d: LoadDetail) => void): void;
  on(type: "relocate" | "load", cb: (d: never) => void): void {
    if (type === "relocate") this.#relocateCb = cb as (d: RelocateDetail) => void;
    else this.#loadCb = cb as (d: LoadDetail) => void;
  }

  async open(file: File): Promise<void> {
    const [{ openBook }, { SectionProgress, TOCProgress }, CFI] = await Promise.all([
      import("./openBook"),
      import("../../vendor/foliate-js/progress.js"),
      import("../../vendor/foliate-js/epubcfi.js"),
    ]);
    const book = await openBook(file);
    this.#book = book;
    this.#sections = book.sections;
    this.#cfi = CFI as typeof import("../../vendor/foliate-js/epubcfi.js");
    this.#toc = book.toc ?? [];

    const ids = book.sections.map((s) => s.id);
    this.#sectionProgress = new SectionProgress(book.sections, 1500, 1600);
    const splitHref = book.splitTOCHref.bind(book);
    const getFragment = book.getTOCFragment.bind(book);
    this.#tocProgress = new TOCProgress();
    await this.#tocProgress.init({ toc: book.toc ?? [], ids, splitHref, getFragment });
  }

  // nav

  #resolve(target: string): { index: number; anchor?: (doc: Document) => Range | Node } | null {
    const book = this.#book;
    const CFI = this.#cfi;
    if (!book || !CFI) return null;
    try {
      if (CFI.isCFI.test(target)) {
        if (book.resolveCFI) return book.resolveCFI(target);
        const parts = CFI.parse(target);
        const index = CFI.fake.toIndex((parts.parent ?? parts).shift());
        return { index, anchor: (doc: Document) => CFI.toRange(doc, parts) };
      }
      return book.resolveHref(target);
    } catch (e) {
      console.warn(`NovusRenderer: could not resolve ${target}`, e);
      return null;
    }
  }

  async goTo(target: string): Promise<boolean> {
    const resolved = this.#resolve(target);
    if (!resolved || !this.#canGoToIndex(resolved.index)) return false;
    await this.#display(resolved.index, resolved.anchor ?? 0, "navigation");
    return true;
  }

  async resetPosition(): Promise<void> {
    const index = this.#sections.findIndex((s) => s.linear !== "no");
    this.#anchor = 0;
    await this.#display(index < 0 ? 0 : index, 0, "navigation");
  }

  next(): void {
    void this.#turnPage(1);
  }
  prev(): void {
    void this.#turnPage(-1);
  }

  setFlow(flow: Flow): void {
    if (flow === this.#flow) return;
    this.#flow = flow;
    this.#container.style.overflow = flow === "scrolled" ? "auto" : "hidden";
    if (this.#iframe?.contentDocument) this.#render("navigation");
  }

  setStyles(css: string): void {
    this.#styles = css;
    if (this.#styleEl) this.#styleEl.textContent = css;
    const doc = this.#iframe?.contentDocument;
    if (doc) {
      requestAnimationFrame(() => (this.#container.style.background = getBackground(doc)));
      doc.fonts?.ready?.then(() => this.#expand());
    }
  }

  destroy(): void {
    this.#observer.disconnect();
    this.#sections[this.#index]?.unload?.();
    this.#container.remove();
    this.#book = null;
    this.#relocateCb = null;
    this.#loadCb = null;
  }

  // display sections

  #canGoToIndex(index: number): boolean {
    return index >= 0 && index <= this.#sections.length - 1;
  }

  #adjacentIndex(dir: 1 | -1): number | null {
    for (let i = this.#index + dir; this.#canGoToIndex(i); i += dir)
      if (this.#sections[i]?.linear !== "no") return i;
    return null;
  }

  async #display(
    index: number,
    anchor: number | ((doc: Document) => Range | Node),
    reason: ScrollReason,
  ): Promise<void> {
    if (index === this.#index) {
      const a = typeof anchor === "function" ? anchor(this.#iframe.contentDocument!) : anchor;
      await this.#scrollToAnchor(a, reason);
      return;
    }
    const section = this.#sections[index];
    if (!section) return;
    let src: string;
    try {
      src = (await section.load()) as string;
    } catch (e) {
      console.warn(`NovusRenderer: failed to load section ${index}`, e);
      return;
    }
    const oldIndex = this.#index;
    this.#index = index;
    await this.#mountSection(src);
    this.#sections[oldIndex]?.unload?.();

    const doc = this.#iframe.contentDocument!;
    const a = typeof anchor === "function" ? anchor(doc) : anchor;
    await this.#scrollToAnchor(a, reason);
  }

  #mountSection(src: string): Promise<void> {
    const element = document.createElement("div");
    Object.assign(element.style, ELEMENT_STYLE);
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, IFRAME_STYLE);
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
    iframe.setAttribute("scrolling", "no");
    element.append(iframe);

    this.#container.replaceChildren(element);
    this.#element = element;
    this.#iframe = iframe;

    return new Promise<void>((resolve) => {
      iframe.addEventListener(
        "load",
        () => {
          const doc = iframe.contentDocument!;
          this.#afterLoad(doc);

          iframe.style.display = "block";
          const { rtl } = getDirection(doc);
          const background = getBackground(doc);
          this.#rtl = rtl;
          this.#container.style.background = background;

          this.#contentRange = doc.createRange();
          this.#contentRange.selectNodeContents(doc.body);

          this.#renderInto(doc);
          resolve();
        },
        { once: true },
      );
      iframe.src = src;
    });
  }

  #afterLoad(doc: Document): void {
    if (doc.head) {
      const style = doc.createElement("style");
      style.textContent = this.#styles;
      doc.head.append(style);
      this.#styleEl = style;
    }
    doc.documentElement.lang ||= "";
    this.#handleLinks(doc);
    this.#loadCb?.({ doc, index: this.#index });
  }

  #handleLinks(doc: Document): void {
    const section = this.#sections[this.#index];
    const book = this.#book;
    doc.addEventListener("click", (e) => {
      const a = (e.target as Element)?.closest?.("a[href]");
      if (!a) return;
      e.preventDefault();
      const raw = a.getAttribute("href")!;
      const href = section?.resolveHref?.(raw) ?? raw;
      if (book?.isExternal?.(href)) return; // no-op for now. TODO: 0.3.0
      void this.goTo(href);
    });
  }

  // layout 

  #beforeRender(): Layout {
    const { width, height } = this.#container.getBoundingClientRect();
    const size = width;
    this.#size = size;

    const g = this.gapPercent;
    const gap = (-g / (g - 1)) * size;
    const margin = this.scrollMargin;
    this.#margin = margin;

    if (this.#flow === "scrolled") {
      return { flow: "scrolled", width, height, gap, columnWidth: this.maxInlineSize, margin };
    }
    const divisor = Math.min(this.maxColumnCount, Math.ceil(size / this.maxInlineSize));
    const columnWidth = size / divisor - gap;
    return { flow: "paginated", width, height, gap, columnWidth, margin };
  }

  #render(reason: ScrollReason): void {
    const doc = this.#iframe?.contentDocument;
    if (!doc) return;
    this.#renderInto(doc);
    void this.#scrollToAnchor(this.#anchor, reason);
  }

  #renderInto(doc: Document): void {
    const layout = this.#beforeRender();
    if (layout.flow === "scrolled") this.#scrolled(doc, layout);
    else this.#columnize(doc, layout);
  }

  #columnize(doc: Document, { width, height, gap, columnWidth }: Layout): void {
    setStylesImportant(doc.documentElement, {
      "box-sizing": "border-box",
      "column-width": `${Math.trunc(columnWidth)}px`,
      "column-gap": `${gap}px`,
      "column-fill": "auto",
      height: `${height}px`,
      padding: `0 ${gap / 2}px`,
      overflow: "hidden",
      "overflow-wrap": "break-word",
      position: "static",
      border: "0",
      margin: "0",
      "max-height": "none",
      "max-width": "none",
      "min-height": "none",
      "min-width": "none",
      "-webkit-line-box-contain": "block glyphs replaced",
    });
    setStylesImportant(doc.body, { "max-height": "none", "max-width": "none", margin: "0" });
    void width;
    this.#setImageSize(doc, height);
    this.#expand();
  }

  #scrolled(doc: Document, { gap, columnWidth }: Layout): void {
    setStylesImportant(doc.documentElement, {
      "box-sizing": "border-box",
      padding: `0 ${gap}px`,
      "column-width": "auto",
      height: "auto",
      width: "auto",
    });
    setStylesImportant(doc.body, { "max-width": `${columnWidth}px`, margin: "auto" });
    this.#setImageSize(doc, 0);
    this.#expand();
  }

  #setImageSize(doc: Document, height: number): void {
    const margin = this.#margin;
    for (const el of doc.body.querySelectorAll<HTMLElement>("img, svg, video")) {
      const { maxWidth } = doc.defaultView!.getComputedStyle(el);
      setStylesImportant(el, {
        "max-height": this.#flow === "scrolled" ? "100%" : `${height - margin * 2}px`,
        "max-width": maxWidth !== "none" && maxWidth !== "0px" ? maxWidth : "100%",
        "object-fit": "contain",
        "break-inside": "avoid",
        "box-sizing": "border-box",
      });
    }
  }

  #expand(): void {
    const doc = this.#iframe.contentDocument;
    if (!doc) return;
    const root = doc.documentElement;
    if (this.#flow !== "scrolled") {
      const contentRect = this.#contentRange.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const contentStart = this.#rtl
        ? rootRect.right - contentRect.right
        : contentRect.left - rootRect.left;
      const contentSize = contentStart + contentRect.width;
      const pageCount = Math.max(1, Math.ceil(contentSize / this.#size));
      const expandedSize = pageCount * this.#size;
      this.#element.style.padding = "0";
      this.#iframe.style.width = `${expandedSize}px`;
      this.#element.style.width = `${expandedSize + this.#size * 2}px`;
      this.#iframe.style.height = "100%";
      this.#element.style.height = "100%";
      root.style.width = `${this.#size}px`;
    } else {
      const contentSize = root.getBoundingClientRect().height;
      const margin = this.#margin;
      this.#element.style.padding = `${margin}px 0`;
      this.#iframe.style.height = `${contentSize}px`;
      this.#element.style.height = `${contentSize}px`;
      this.#iframe.style.width = "100%";
      this.#element.style.width = "100%";
    }
  }

  // scroll position

  get #scrollProp(): "scrollLeft" | "scrollTop" {
    return this.#flow === "scrolled" ? "scrollTop" : "scrollLeft";
  }
  get #sideProp(): "width" | "height" {
    return this.#flow === "scrolled" ? "height" : "width";
  }
  get #start(): number {
    return Math.abs(this.#container[this.#scrollProp]);
  }
  get #containerSize(): number {
    return this.#container.getBoundingClientRect()[this.#sideProp];
  }
  get #viewSize(): number {
    return this.#element.getBoundingClientRect()[this.#sideProp];
  }
  get #pages(): number {
    return Math.round(this.#viewSize / this.#containerSize);
  }
  get #page(): number {
    const size = this.#containerSize;
    return Math.floor((this.#start + this.#start + size) / 2 / size);
  }

  #rectMapper(): RectMapper {
    if (this.#flow === "scrolled") {
      const margin = this.#margin;
      return ({ top, bottom }: DOMRect | { top?: number; bottom?: number; left: number; right: number }) =>
        ({ left: (top ?? 0) + margin, right: (bottom ?? 0) + margin });
    }
    if (this.#rtl) {
      const pxSize = this.#pages * this.#containerSize;
      return ({ left, right }) => ({ left: pxSize - right, right: pxSize - left });
    }
    return (r) => ({ left: r.left, right: r.right });
  }

  #getVisibleRange(): Range {
    const doc = this.#iframe.contentDocument!;
    const size = this.#containerSize;
    if (this.#flow === "scrolled")
      return getVisibleRange(doc, this.#start + this.#margin, this.#start + size - this.#margin, this.#rectMapper());
    const s = this.#rtl ? -size : size;
    return getVisibleRange(doc, this.#start - s, this.#start + size - s, this.#rectMapper());
  }

  async #scrollToPage(page: number, reason: ScrollReason): Promise<void> {
    const offset = this.#containerSize * (this.#rtl ? -page : page);
    this.#container[this.#scrollProp] = offset;
    this.#afterScroll(reason);
  }

  async #scrollToOffset(offset: number, reason: ScrollReason): Promise<void> {
    this.#container[this.#scrollProp] = offset;
    this.#afterScroll(reason);
  }

  async #scrollToAnchor(anchor: number | Range | Node, reason: ScrollReason): Promise<void> {
    this.#anchor = anchor;
    const target = uncollapse(anchor as Range | Node | null);
    const rects = (target as Range | Element)?.getClientRects?.();
    if (rects && rects.length) {
      const rect = Array.from(rects).find((r) => r.width > 0 && r.height > 0) ?? rects[0];
      if (!rect) return;
      const mapped = this.#rectMapper()(rect);
      if (this.#flow === "scrolled") {
        await this.#scrollToOffset(mapped.left - this.#margin, reason);
      } else {
        await this.#scrollToPage(Math.floor(mapped.left / this.#containerSize) + (this.#rtl ? -1 : 1), reason);
      }
      return;
    }

    const frac = typeof anchor === "number" ? anchor : 0;
    if (this.#flow === "scrolled") {
      await this.#scrollToOffset(frac * this.#viewSize, reason);
      return;
    }
    const pages = this.#pages;
    if (!pages) return;
    const textPages = pages - 2;
    const newPage = Math.round(frac * Math.max(0, textPages - 1));
    await this.#scrollToPage(newPage + 1, reason);
  }

  #afterScroll(reason: ScrollReason): void {
    const range = this.#getVisibleRange();
    if (reason !== "navigation" && reason !== "anchor" && reason !== "resize") this.#anchor = range;

    let fractionInSection: number;
    let pageFraction = 0;
    if (this.#flow === "scrolled") {
      fractionInSection = this.#viewSize ? this.#start / this.#viewSize : 0;
    } else {
      const pages = this.#pages;
      const textPages = Math.max(1, pages - 2);
      fractionInSection = (this.#page - 1) / textPages;
      pageFraction = 1 / textPages;
    }

    const progress = this.#sectionProgress?.getProgress(this.#index, fractionInSection, pageFraction);
    const tocItem = this.#tocProgress?.getProgress(this.#index, range) ?? null;
    const cfi = this.#getCFI(range);
    this.#relocateCb?.({
      fraction: progress?.fraction ?? fractionInSection,
      cfi,
      tocItem,
    });
  }

  #getCFI(range: Range): string | null {
    const CFI = this.#cfi;
    if (!CFI) return null;
    try {
      const base = this.#sections[this.#index]?.cfi ?? CFI.fake.fromIndex(this.#index);
      return CFI.joinIndir(base, CFI.fromRange(range));
    } catch {
      return null;
    }
  }

  // page turning

  async #turnPage(dir: 1 | -1): Promise<void> {
    if (this.#locked || !this.#iframe?.contentDocument) return;
    this.#locked = true;
    try {
      const prev = dir === -1;
      const atBoundary = prev ? this.#atStart : this.#atEnd;
      if (!atBoundary) {
        const page = this.#page + dir;
        await this.#scrollToPage(page, "page");
      } else {
        const index = this.#adjacentIndex(dir);
        if (index != null) await this.#display(index, prev ? 1 : 0, "navigation");
      }
    } finally {
      this.#locked = false;
    }
  }

  get #atStart(): boolean {
    return this.#adjacentIndex(-1) == null && this.#page <= 1;
  }
  get #atEnd(): boolean {
    return this.#adjacentIndex(1) == null && this.#page >= this.#pages - 2;
  }
}
