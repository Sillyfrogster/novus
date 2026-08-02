import * as CFI from "../../vendor/foliate-js/epubcfi.js";

import type {
  ReaderDestination,
  ReaderEvent,
  ReaderListener,
  ReaderPresentation,
  ReaderSession,
} from "./contract";
import { FrameBatch } from "./FrameBatch";
import { getVisibleRange, uncollapse, type RectMapper } from "./geometry";
import { unwrapHighlightMarks, wrapRangeInMarks } from "./highlightMarks";
import { openPublicationBook } from "./openPublicationBook";
import { readerCss } from "./presentation";
import { bindSelectionEvents } from "./selectionEvents";
import type {
  BookModel,
  BookSection,
  Flow,
  RelocateReason,
  RenderHighlight,
  TocItem,
} from "./types";

type ScrollReason = "anchor" | "navigation" | "turn" | "page" | "scroll" | "resize";

/** Public reason reported on relocate. "turn" crosses a section boundary but is still a page turn. */
const RELOCATE_REASON: Record<ScrollReason, RelocateReason> = {
  page: "page",
  turn: "page",
  scroll: "scroll",
  navigation: "jump",
  anchor: "jump",
  resize: "layout",
};

/** Settle delay before a user scroll in scrolled flow is reported as a relocate. */
const SCROLL_SETTLE_MS = 150;

/** Ignore highlight wrappers when saving positions */
const cfiFilter = (node: Node): number =>
  node.nodeType === 1 && (node as Element).classList?.contains("nv-hl")
    ? NodeFilter.FILTER_SKIP
    : NodeFilter.FILTER_ACCEPT;

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

/** Shape of foliate `SectionProgress.getProgress` that we're reliant on */
interface SectionProgressResult {
  fraction: number;
  location: { current: number; next: number; total: number };
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

export class NovusRenderer implements ReaderSession {
  maxInlineSize = 720;
  maxColumnCount = 2;
  gapPercent = 0.07;
  scrollMargin = 48;

  #container: HTMLDivElement;
  #element: HTMLDivElement;
  #iframe!: HTMLIFrameElement;
  #contentRange = document.createRange();

  #book: BookModel | null = null;
  #sections: BookSection[] = [];
  #sectionProgress: import("../../vendor/foliate-js/progress.js").SectionProgress | null = null;
  #tocProgress: import("../../vendor/foliate-js/progress.js").TOCProgress | null = null;
  #cfi: typeof CFI | null = null;
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
  #pendingTurn: 1 | -1 | null = null;
  #displayGeneration = 0;
  #cancelMount: (() => void) | null = null;

  #observer: ResizeObserver;
  #scrollTimer: ReturnType<typeof setTimeout> | null = null;
  #suppressScroll = false;
  #renderBatch = new FrameBatch();
  #activityBatch = new FrameBatch();
  #listeners = new Set<ReaderListener>();
  #disposed = false;

  #highlights: RenderHighlight[] = [];
  #newHighlightId: string | null = null;
  #unbindSelection: (() => void) | null = null;

  constructor(host: HTMLElement) {
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
    host.append(this.#container);

    this.#observer = new ResizeObserver(() => this.#render("resize"));
    this.#observer.observe(this.#container);

    // Wheel/trackpad scrolling in scrolled flow never passes through our
    // scroll helpers, so listen on the container and report it once settled.
    this.#container.addEventListener("scroll", () => this.#onUserScroll(), { passive: true });
  }

  #onUserScroll(): void {
    if (this.#flow !== "scrolled" || this.#suppressScroll) return;
    if (this.#scrollTimer) clearTimeout(this.#scrollTimer);
    this.#scrollTimer = setTimeout(() => this.#afterScroll("scroll"), SCROLL_SETTLE_MS);
  }

  subscribe(listener: ReaderListener): () => void {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: ReaderEvent): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) listener(event);
  }

  async open(bookId: string): Promise<readonly TocItem[]> {
    if (this.#disposed) throw new Error("Reader is closed");
    if (this.#book) throw new Error("Reader is already open");

    const [book, { SectionProgress, TOCProgress }] = await Promise.all([
      openPublicationBook(bookId),
      import("../../vendor/foliate-js/progress.js"),
    ]);
    if (this.#disposed) {
      book.destroy?.();
      throw new Error("Reader is closed");
    }
    this.#book = book;
    this.#sections = book.sections;
    this.#toc = book.toc ?? [];
    this.#cfi = CFI;

    const ids = book.sections.map((s) => String(s.id));
    this.#sectionProgress = new SectionProgress(book.sections, 1500, 1600);
    const splitHref = book.splitTOCHref.bind(book);
    const getFragment = book.getTOCFragment.bind(book);
    this.#tocProgress = new TOCProgress();
    await this.#tocProgress.init({ toc: book.toc ?? [], ids, splitHref, getFragment });
    return this.#toc;
  }

  // nav

  /** Resolve a CFI locator synchronously (highlights depend on this being sync). */
  #resolveCfi(cfi: string): { index: number; anchor?: (doc: Document) => Range | Node } | null {
    const book = this.#book;
    const CFI = this.#cfi;
    if (!book || !CFI) return null;
    try {
      const resolved = book.resolveCFI?.(cfi);
      if (resolved) return resolved;
    } catch {
    }
    try {
      const parts = CFI.parse(cfi);
      const index = CFI.fake.toIndex((parts.parent ?? parts).shift());
      return { index, anchor: (doc: Document) => CFI.toRange(doc, parts) };
    } catch (e) {
      console.warn(`NovusRenderer: could not resolve ${cfi}`, e);
      return null;
    }
  }

  /** Resolve any locator: a CFI or an href. */
  async #resolve(
    target: string,
  ): Promise<{ index: number; anchor?: (doc: Document) => Range | Node } | null> {
    const book = this.#book;
    if (!book) return null;
    if (this.#cfi?.isCFI.test(target)) return this.#resolveCfi(target);
    try {
      return await book.resolveHref(target);
    } catch (e) {
      console.warn(`NovusRenderer: could not resolve ${target}`, e);
      return null;
    }
  }

  async navigate(destination: ReaderDestination): Promise<boolean> {
    if (this.#disposed) return false;
    if (destination.kind === "start") return this.#goToStart();
    if (destination.kind === "highlight") return this.#goToHighlight(destination.value);
    return this.#goToTarget(destination.value);
  }

  async #goToTarget(target: string): Promise<boolean> {
    const resolved = await this.#resolve(target);
    if (!resolved || !this.#canGoToIndex(resolved.index)) return false;
    return this.#display(resolved.index, resolved.anchor ?? 0, "navigation");
  }

  async #goToStart(): Promise<boolean> {
    const index = this.#sections.findIndex((s) => s.linear !== "no");
    const target = index < 0 ? 0 : index;
    if (!this.#canGoToIndex(target)) return false;
    this.#anchor = 0;
    return this.#display(target, 0, "navigation");
  }

  turn(direction: "next" | "previous"): void {
    if (this.#disposed) return;
    const value = direction === "next" ? 1 : -1;
    if (this.#locked) {
      this.#pendingTurn = value;
      return;
    }
    void this.#turnPage(value);
  }

  configure(presentation: ReaderPresentation): void {
    if (this.#disposed) return;
    const flow = presentation.layout === "paged" ? "paginated" : "scrolled";
    const styles = readerCss(presentation);
    const changed =
      flow !== this.#flow ||
      presentation.measure !== this.maxInlineSize ||
      styles !== this.#styles;
    if (!changed) return;

    this.#flow = flow;
    this.maxInlineSize = presentation.measure;
    this.#styles = styles;
    this.#container.style.overflow = flow === "scrolled" ? "auto" : "hidden";
    if (!this.#iframe?.contentDocument) return;

    this.#renderBatch.schedule(() => {
      const doc = this.#iframe?.contentDocument;
      if (!doc) return;
      if (this.#styleEl) this.#styleEl.textContent = this.#styles;
      this.#container.style.background = getBackground(doc);
      this.#render("resize");
      void doc.fonts?.ready?.then(() => {
        if (!this.#disposed && doc === this.#iframe?.contentDocument) this.#expand();
      });
    });
  }

  replaceHighlights(highlights: readonly RenderHighlight[], newId?: string): void {
    if (this.#disposed) return;
    this.#highlights = [...highlights];
    this.#newHighlightId = newId ?? null;
    const doc = this.#iframe?.contentDocument;
    if (!doc) return;
    this.#renderHighlights(doc);
    try {
      this.#anchor = this.#getVisibleRange();
    } catch {
    }
  }

  clearSelection(): void {
    if (this.#disposed) return;
    this.#iframe?.contentDocument?.getSelection()?.removeAllRanges();
    this.#emit({ type: "selection", detail: null });
  }

  async #goToHighlight(cfi: string): Promise<boolean> {
    const CFI = this.#cfi;
    if (!CFI) return false;
    try {
      const resolved = this.#resolveCfi(cfi);
      if (!resolved || !this.#canGoToIndex(resolved.index)) return false;
      const parts = CFI.parse(cfi);
      return this.#display(
        resolved.index,
        (doc) => CFI.toRange(doc, parts, cfiFilter),
        "navigation",
      );
    } catch (e) {
      console.warn(`NovusRenderer: could not navigate to highlight ${cfi}`, e);
      return false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#observer.disconnect();
    if (this.#scrollTimer) clearTimeout(this.#scrollTimer);
    this.#renderBatch.clear();
    this.#activityBatch.clear();
    this.#pendingTurn = null;
    this.#displayGeneration += 1;
    this.#cancelMount?.();
    this.#cancelMount = null;
    this.#unbindSelection?.();
    this.#unbindSelection = null;
    this.#sections[this.#index]?.unload?.();
    this.#book?.destroy?.();
    this.#container.remove();
    this.#book = null;
    this.#sections = [];
    this.#sectionProgress = null;
    this.#tocProgress = null;
    this.#cfi = null;
    this.#toc = [];
    this.#styleEl = null;
    this.#highlights = [];
    this.#listeners.clear();
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
  ): Promise<boolean> {
    const generation = ++this.#displayGeneration;
    if (index === this.#index) {
      const document = this.#iframe?.contentDocument;
      if (!document) return false;
      const a = typeof anchor === "function" ? anchor(document) : anchor;
      await this.#scrollToAnchor(a, reason);
      return true;
    }
    const section = this.#sections[index];
    if (!section) return false;
    let source: string;
    try {
      source = await section.load();
    } catch (e) {
      console.warn(`NovusRenderer: failed to load section ${index}`, e);
      return false;
    }
    if (this.#disposed || generation !== this.#displayGeneration) {
      section.unload?.();
      return false;
    }

    const oldIndex = this.#index;
    const mounted = await this.#mountSection(source, index, generation);
    if (!mounted) {
      section.unload?.();
      return false;
    }
    this.#sections[oldIndex]?.unload?.();
    if (this.#disposed || generation !== this.#displayGeneration) return false;

    const doc = this.#iframe.contentDocument!;
    const a = typeof anchor === "function" ? anchor(doc) : anchor;
    await this.#scrollToAnchor(a, reason);
    return !this.#disposed && generation === this.#displayGeneration;
  }

  #mountSection(
    src: string,
    index: number,
    generation: number,
  ): Promise<boolean> {
    this.#cancelMount?.();

    const element = document.createElement("div");
    Object.assign(element.style, ELEMENT_STYLE);
    Object.assign(element.style, {
      position: "absolute",
      inset: "0",
      visibility: "hidden",
    });
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, IFRAME_STYLE);
    iframe.setAttribute("sandbox", "allow-same-origin");
    iframe.setAttribute("scrolling", "no");
    element.append(iframe);
    this.#container.append(element);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let cancel = () => {};
      const finish = (mounted: boolean) => {
        if (settled) return;
        settled = true;
        iframe.removeEventListener("load", onLoad);
        if (this.#cancelMount === cancel) this.#cancelMount = null;
        resolve(mounted);
      };
      const onLoad = () => {
        if (
          this.#disposed ||
          generation !== this.#displayGeneration
        ) {
          element.remove();
          finish(false);
          return;
        }

        const oldElement = this.#element;
        const oldIframe = this.#iframe;
        const oldIndex = this.#index;
        const oldStyle = this.#styleEl;
        try {
          const doc = iframe.contentDocument!;
          if (!doc?.body) throw new Error("The publication section has no body");

          element.style.position = "relative";
          element.style.inset = "";
          element.style.visibility = "";
          oldElement.remove();
          this.#element = element;
          this.#iframe = iframe;
          this.#index = index;
          this.#afterLoad(doc);

          iframe.style.display = "block";
          const { rtl } = getDirection(doc);
          const background = getBackground(doc);
          this.#rtl = rtl;
          this.#container.style.background = background;

          this.#contentRange = doc.createRange();
          this.#contentRange.selectNodeContents(doc.body);

          this.#renderInto(doc);
          finish(true);
        } catch (error) {
          if (!this.#disposed && generation === this.#displayGeneration) {
            this.#container.replaceChildren(oldElement);
            this.#element = oldElement;
            this.#iframe = oldIframe;
            this.#index = oldIndex;
            this.#styleEl = oldStyle;
          }
          console.warn("NovusRenderer: could not mount this section", error);
          finish(false);
        }
      };
      cancel = () => {
        element.remove();
        finish(false);
      };
      this.#cancelMount = cancel;
      iframe.addEventListener("load", onLoad, { once: true });
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
    this.#bindSelection(doc);
    this.#renderHighlights(doc);
  }

  // selection capture

  #bindSelection(doc: Document): void {
    this.#unbindSelection?.();
    doc.addEventListener("mousemove", () =>
      this.#activityBatch.schedule(() => this.#emit({ type: "activity" })),
    );
    this.#unbindSelection = bindSelectionEvents(doc, {
      onStart: () => this.#emit({ type: "selection", detail: null }),
      onFinish: () => this.#reportSelection(doc),
    });
  }

  #reportSelection(doc: Document): void {
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      this.#emit({ type: "selection", detail: null });
      return;
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text) {
      this.#emit({ type: "selection", detail: null });
      return;
    }
    const range = sel.getRangeAt(0);
    const r = range.getBoundingClientRect();
    const fr = this.#iframe.getBoundingClientRect();
    this.#emit({
      type: "selection",
      detail: {
        text,
        cfi: this.#getCFI(range),
        sectionIndex: this.#index,
        rect: {
          top: fr.top + r.top,
          bottom: fr.top + r.bottom,
          left: fr.left + r.left,
          right: fr.left + r.right,
        },
      },
    });
  }

  // highlight marks

  #renderHighlights(doc: Document): void {
    const CFI = this.#cfi;
    if (!CFI || !doc.body) return;
    unwrapHighlightMarks(doc);
    const here = this.#highlights.filter((h) => h.sectionIndex === this.#index);
    if (here.length === 0) return;
    const resolved: { h: RenderHighlight; range: Range }[] = [];
    for (const h of here) {
      try {
        const r = this.#resolveCfi(h.cfi);
        if (!r || r.index !== this.#index || !r.anchor) continue;
        const range = r.anchor(doc) as Range;
        if (range && range.collapsed === false) resolved.push({ h, range });
      } catch {
      }
    }
    resolved.sort((a, b) => b.range.compareBoundaryPoints(Range.START_TO_START, a.range));
    for (const { h, range } of resolved) {
      wrapRangeInMarks(range, {
        id: h.id,
        color: h.color,
        isNew: h.id === this.#newHighlightId,
      });
    }
    this.#newHighlightId = null;
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
      void this.#goToTarget(href);
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
  get #end(): number {
    return this.#start + this.#containerSize;
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
    this.#setScrollPosition(offset);
    this.#afterScroll(reason);
  }

  async #scrollToOffset(offset: number, reason: ScrollReason): Promise<void> {
    this.#setScrollPosition(offset);
    this.#afterScroll(reason);
  }

  /** Programmatic scrolls fire the container's scroll event too; keep them out of #onUserScroll. */
  #setScrollPosition(offset: number): void {
    this.#suppressScroll = true;
    if (this.#scrollTimer) clearTimeout(this.#scrollTimer);
    this.#container[this.#scrollProp] = offset;
    setTimeout(() => {
      this.#suppressScroll = false;
    }, SCROLL_SETTLE_MS);
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
    try {
      const range = this.#getVisibleRange();
      if (reason !== "navigation" && reason !== "anchor" && reason !== "turn" && reason !== "resize")
        this.#anchor = range;

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

      const progress = this.#sectionProgress?.getProgress(
        this.#index,
        fractionInSection,
        pageFraction,
      ) as SectionProgressResult | undefined;
      const tocItem = this.#tocProgress?.getProgress(this.#index, range) ?? null;
      const cfi = this.#getCFI(range);
      const loc = progress?.location;
      this.#emit({
        type: "relocate",
        detail: {
          fraction: progress?.fraction ?? fractionInSection,
          cfi,
          tocItem,
          location: loc ? { current: loc.current, total: loc.total } : null,
          reason: RELOCATE_REASON[reason],
        },
      });
    } catch (e) {
      console.warn("NovusRenderer: relocate reporting failed", e);
    }
  }

  #getCFI(range: Range): string | null {
    const CFI = this.#cfi;
    if (!CFI) return null;
    try {
      const base = this.#sections[this.#index]?.cfi ?? CFI.fake.fromIndex(this.#index);
      return CFI.joinIndir(base, CFI.fromRange(range, cfiFilter));
    } catch {
      return null;
    }
  }

  // page turning

  async #turnPage(dir: 1 | -1): Promise<void> {
    if (!this.#iframe?.contentDocument) return;
    this.#locked = true;
    try {
      const prev = dir === -1;
      const crossSection = prev ? await this.#scrollPrev() : await this.#scrollNext();
      if (crossSection) {
        const index = this.#adjacentIndex(dir);
        if (index != null) await this.#display(index, prev ? 1 : 0, "turn");
      }
    } finally {
      this.#locked = false;
      const pending = this.#pendingTurn;
      this.#pendingTurn = null;
      if (pending !== null) void this.#turnPage(pending);
    }
  }

  /** Returns true when already at the start of this section  */
  async #scrollPrev(): Promise<boolean> {
    if (!this.#iframe?.contentDocument) return true;
    if (this.#flow === "scrolled") {
      if (this.#start > 0) {
        await this.#scrollToOffset(Math.max(0, this.#start - this.#containerSize), "page");
        return false;
      }
      return true;
    }
    if (this.#atStart) return false;
    const page = this.#page - 1;
    await this.#scrollToPage(page, "page");
    return page <= 0;
  }

  /** Returns true when already at the end of this section */
  async #scrollNext(): Promise<boolean> {
    if (!this.#iframe?.contentDocument) return true;
    if (this.#flow === "scrolled") {
      if (this.#viewSize - this.#end > 2) {
        await this.#scrollToOffset(Math.min(this.#viewSize, this.#end), "page");
        return false;
      }
      return true;
    }
    if (this.#atEnd) return false;
    const pages = this.#pages;
    const page = this.#page + 1;
    await this.#scrollToPage(page, "page");
    return page >= pages - 1;
  }

  get #atStart(): boolean {
    return this.#adjacentIndex(-1) == null && this.#page <= 1;
  }
  get #atEnd(): boolean {
    return this.#adjacentIndex(1) == null && this.#page >= this.#pages - 2;
  }
}
