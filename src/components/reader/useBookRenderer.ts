import { useEffect, useRef, useState } from "react";

import { bookUrl } from "../../lib/assets";
import {
  HIGHLIGHT_COLOR_KEYS,
  tintFor,
  type HighlightColor,
} from "../../lib/highlightColors";
import { getReadingState, recordSession, saveReadingState } from "../../lib/ipc";
import type { Highlight, HighlightColorKey } from "../../lib/types";
import { loadReaderFactory } from "../../reader/loadReader";
import { ReadingSession } from "../../reader/readingSession";
import type {
  ReaderSurface,
  RenderHighlight,
  SelectionDetail,
  TocItem,
} from "../../reader/types";
import { useHighlights } from "../../store/highlights";
import { useLibrary } from "../../store/library";
import {
  FONT_STACKS,
  useReaderSettings,
  type ReaderSettings,
} from "../../store/reader";

type ColorMap = Record<HighlightColorKey, HighlightColor>;

const READ_THEMES: Record<ReaderSettings["readTheme"], { bg: string; ink: string }> = {
  light: { bg: "#f4f5f7", ink: "#1b1d23" },
  sepia: { bg: "#ece1cf", ink: "#433a2b" },
  dark: { bg: "#0c0d10", ink: "#c9ccd4" },
};

const DWELL_SAVE_MS = 3000;
const UNMOUNT_SAVE_MIN_DWELL_MS = 1500;
const SESSION_FLUSH_MS = 60_000;

function hrefTail(href: string): string {
  return href.split("/").pop() ?? href;
}

function resolveTocTarget(toc: TocItem[] | undefined, target: string): string {
  const tail = hrefTail(target);
  const flat: TocItem[] = [];
  const walk = (items?: TocItem[]) =>
    items?.forEach((item) => {
      if (item.href) flat.push(item);
      walk(item.subitems);
    });
  walk(toc);
  return flat.find((item) => hrefTail(item.href) === tail)?.href ?? target;
}

function applyLayout(renderer: ReaderSurface, settings: ReaderSettings): void {
  renderer.setFlow(settings.layout === "paged" ? "paginated" : "scrolled");
  renderer.setMaxInlineSize(settings.measure);
}

function buildHighlightCss(colors: ColorMap): string {
  const slots = HIGHLIGHT_COLOR_KEYS.map(
    (key) =>
      `mark.nv-hl[data-color="${key}"] { background-image: linear-gradient(${tintFor(colors[key].color)}, ${tintFor(colors[key].color)}); }`,
  ).join("\n");
  return `
    mark.nv-hl {
      color: inherit !important;
      background-color: transparent;
      background-repeat: no-repeat;
      background-position: 0 0;
      background-size: 100% 100%;
      border-radius: 2px;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }
    ${slots}
    @keyframes nvHlSweep { from { background-size: 0% 100%; } to { background-size: 100% 100%; } }
    mark.nv-hl-new { animation: nvHlSweep 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    @media (prefers-reduced-motion: reduce) { mark.nv-hl-new { animation: none; } }
  `;
}

function buildBookCss(settings: ReaderSettings, colors: ColorMap): string {
  const theme = READ_THEMES[settings.readTheme];
  const justify = settings.align === "justify";
  const embedded = `
    blockquote {
      margin-block: 1.3em;
      margin-inline: 0;
      padding-inline-start: 1.15em;
      border-inline-start: 2px solid color-mix(in srgb, ${theme.ink} 24%, transparent);
      color: color-mix(in srgb, ${theme.ink} 84%, ${theme.bg}) !important;
    }
    blockquote p { text-indent: 0; margin-block: 0.4em; }
    figure { margin-inline: 0; text-align: center; }
    figcaption { font-size: 0.82em; opacity: 0.7; margin-block-start: 0.5em; }
  `;

  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${settings.readTheme === "dark" ? "dark" : "light"}; font-size: ${settings.fontSize}px; background: ${theme.bg} !important; color: ${theme.ink} !important; }
    body { background: ${theme.bg} !important; color: ${theme.ink} !important; }
    body :where(p, li, dd, dt, ol, ul, dl, h1, h2, h3, h4, h5, h6, span, em, strong,
      b, i, u, s, small, sub, sup, mark, cite, q, abbr, time, address, div, section,
      article, header, footer, aside, main, nav, table, thead, tbody, tr, td, th,
      caption, figure, figcaption, hr, label) {
      color: inherit !important;
      background-color: transparent !important;
    }
    p, li, dd, dt, blockquote, td, th {
      font-family: ${FONT_STACKS[settings.font]} !important;
      font-size: ${settings.fontSize}px !important;
      line-height: ${settings.lineHeight} !important;
      text-align: ${justify ? "justify" : "start"};
      -webkit-hyphens: ${justify ? "auto" : "manual"};
      hyphens: ${justify ? "auto" : "manual"};
    }
    caption, figcaption {
      font-family: ${FONT_STACKS[settings.font]} !important;
      line-height: ${settings.lineHeight} !important;
    }
    p { margin-block: ${settings.paragraphSpacing}em; }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    [align="justify"] { text-align: justify; }
    ${embedded}
    a:link, a:visited { color: ${theme.ink} !important; }
    pre { white-space: pre-wrap !important; }
    ${buildHighlightCss(colors)}
  `;
}

interface UseBookRendererOptions {
  activeBookId: string | null;
  storageRoot: string;
  settings: ReaderSettings;
  colors: ColorMap;
  highlights: Highlight[];
  revealChrome: () => void;
}

export function useBookRenderer({
  activeBookId,
  storageRoot,
  settings,
  colors,
  highlights,
  revealChrome,
}: UseBookRendererOptions) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ReaderSurface | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ cfi: string | null; fraction: number } | null>(null);
  const lastMoveAt = useRef(0);
  const restored = useRef(false);
  const session = useRef<ReadingSession | null>(null);
  const lastFraction = useRef(0);
  const pendingNewId = useRef<string | null>(null);
  const revealChromeRef = useRef(revealChrome);

  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [location, setLocation] = useState<{ current: number; total: number } | null>(null);
  const [chapter, setChapter] = useState("");
  const [toc, setToc] = useState<TocItem[]>([]);
  const [selection, setSelection] = useState<SelectionDetail | null>(null);

  useEffect(() => {
    revealChromeRef.current = revealChrome;
  }, [revealChrome]);

  useEffect(() => {
    if (!activeBookId || !storageRoot) return;
    const currentBook = useLibrary.getState().books.find((item) => item.id === activeBookId);
    if (!currentBook) return;

    let cancelled = false;
    let renderer: ReaderSurface | null = null;
    let loadedDocument: Document | null = null;
    const controller = new AbortController();
    const revealInDocument = () => revealChromeRef.current();

    const onRelocate = (detail: import("../../reader/types").RelocateDetail) => {
      const fraction = detail.fraction ?? 0;
      setProgress(fraction);
      setLocation(detail.location ?? null);
      if (detail.tocItem?.label) setChapter(detail.tocItem.label);
      lastFraction.current = fraction;
      if (!restored.current || detail.reason === "layout") return;
      session.current?.add(fraction, detail.reason);
      lastMoveAt.current = Date.now();
      pendingSave.current = { cfi: detail.cfi ?? null, fraction };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const pending = pendingSave.current;
        if (!pending) return;
        pendingSave.current = null;
        saveReadingState(currentBook.id, pending.cfi, pending.fraction).catch(() => {});
      }, DWELL_SAVE_MS);
    };

    const onLoad = (detail: import("../../reader/types").LoadDetail) => {
      loadedDocument?.removeEventListener("mousemove", revealInDocument);
      loadedDocument = detail.doc;
      detail.doc.addEventListener("mousemove", revealInDocument);
    };

    const onSelection = (detail: SelectionDetail | null) => {
      setSelection(detail);
    };

    lastFraction.current = 0;
    restored.current = false;
    pendingSave.current = null;
    session.current = null;

    const flushSession = () => {
      const record = session.current?.toRecord(currentBook.id);
      if (record) recordSession(record).catch(() => {});
    };
    const flushTimer = setInterval(flushSession, SESSION_FLUSH_MS);

    const openBook = async () => {
      const url = bookUrl(currentBook, storageRoot);
      if (!url || !hostRef.current || cancelled) return;
      const bookFile = fetch(url, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(`Could not open book: ${response.status}`);
        return response.blob();
      });
      const [createReader, blob] = await Promise.all([loadReaderFactory(), bookFile]);
      if (cancelled) return;
      const file = new File([blob], `book.${currentBook.format}`);

      renderer = createReader(hostRef.current);
      viewRef.current = renderer;
      renderer.on("relocate", onRelocate);
      renderer.on("load", onLoad);
      renderer.on("selection", onSelection);
      await renderer.open(file);
      if (cancelled) return;

      const currentSettings = useReaderSettings.getState();
      const currentColors = useHighlights.getState().colors;
      applyLayout(renderer, currentSettings);
      renderer.setStyles(buildBookCss(currentSettings, currentColors));
      setToc(renderer.toc);

      const pending = useLibrary.getState().consumePendingLocator();
      if (pending) {
        const target = resolveTocTarget(renderer.toc, pending);
        const reached = await renderer.goTo(target);
        if (cancelled) return;
        if (!reached) await renderer.resetPosition();
      } else {
        const saved = await getReadingState(currentBook.id);
        if (cancelled) return;
        if (saved?.locator) {
          const reached = await renderer.goTo(saved.locator);
          if (cancelled) return;
          if (!reached) await renderer.resetPosition();
        } else {
          await renderer.resetPosition();
        }
      }
      if (cancelled) return;
      restored.current = true;
      session.current = new ReadingSession(lastFraction.current);
      setReady(true);
    };

    void openBook().catch((error: unknown) => {
      if (cancelled || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Could not open book";
      useLibrary.setState({ error: message });
    });

    return () => {
      cancelled = true;
      controller.abort();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const pending = pendingSave.current;
      if (pending && Date.now() - lastMoveAt.current >= UNMOUNT_SAVE_MIN_DWELL_MS) {
        saveReadingState(currentBook.id, pending.cfi, pending.fraction).catch(() => {});
      }
      pendingSave.current = null;
      clearInterval(flushTimer);
      flushSession();
      session.current = null;
      loadedDocument?.removeEventListener("mousemove", revealInDocument);
      renderer?.off("relocate", onRelocate);
      renderer?.off("load", onLoad);
      renderer?.off("selection", onSelection);
      renderer?.destroy();
      viewRef.current = null;
      setReady(false);
    };
  }, [activeBookId, storageRoot]);

  useEffect(() => {
    const renderer = viewRef.current;
    if (!renderer || !ready) return;
    applyLayout(renderer, settings);
    renderer.setStyles(buildBookCss(settings, colors));
  }, [ready, settings, colors]);

  useEffect(() => {
    if (activeBookId) void useHighlights.getState().loadFor(activeBookId);
  }, [activeBookId]);

  useEffect(() => {
    const renderer = viewRef.current;
    if (!renderer || !ready) return;
    const list: RenderHighlight[] = highlights.map((highlight) => ({
      id: highlight.id,
      cfi: highlight.cfi,
      color: highlight.color,
      sectionIndex: highlight.sectionIndex,
    }));
    renderer.setHighlights(list, pendingNewId.current ?? undefined);
    pendingNewId.current = null;
  }, [ready, highlights]);

  return {
    hostRef,
    viewRef,
    pendingNewId,
    ready,
    progress,
    location,
    chapter,
    toc,
    selection,
    setSelection,
  };
}
