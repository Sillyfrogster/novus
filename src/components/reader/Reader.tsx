import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, List, X } from "lucide-react";

import { bookUrl } from "../../lib/assets";
import { getReadingState, logSession, saveReadingState } from "../../lib/ipc";
import { FONT_STACKS, useReaderSettings, type ReaderSettings } from "../../store/reader";
import { useLibrary } from "../../store/library";
import { DisplaySettings } from "./DisplaySettings";
import styles from "./Reader.module.css";

interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

interface RelocateDetail {
  fraction?: number;
  tocItem?: { label?: string };
  cfi?: string;
}

/** Minimal surface of the vendored <foliate-view> element.*/
interface FoliateView extends HTMLElement {
  book?: { toc?: TocItem[] };
  renderer: {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    setStyles?(css: string): void;
    next(): void;
  };
  open(book: Blob | File): Promise<void>;
  goTo(target: string): Promise<void>;
  prev(): Promise<void>;
  next(): Promise<void>;
}

/* filename */
function hrefTail(href: string): string {
  return href.split("/").pop() ?? href;
}

/* chapter target */
function resolveTocTarget(toc: TocItem[] | undefined, target: string): string {
  const tail = hrefTail(target);
  const flat: TocItem[] = [];
  const walk = (items?: TocItem[]) =>
    items?.forEach((it) => {
      if (it.href) flat.push(it);
      walk(it.subitems);
    });
  walk(toc);
  return flat.find((it) => hrefTail(it.href) === tail)?.href ?? target;
}

function applyLayout(view: FoliateView, s: ReaderSettings): void {
  view.renderer.setAttribute("flow", s.layout === "paged" ? "paginated" : "scrolled");
}

const READ_THEMES: Record<ReaderSettings["readTheme"], { bg: string; ink: string }> = {
  light: { bg: "#f4f5f7", ink: "#1b1d23" },
  sepia: { bg: "#ece1cf", ink: "#433a2b" },
  dark: { bg: "#0c0d10", ink: "#c9ccd4" },
};
const CHROME_IDLE_MS = 2600;

function buildBookCss(s: ReaderSettings): string {
  const t = READ_THEMES[s.readTheme];
  const justify = s.align === "justify";
  const embedded = `
    blockquote {
      margin-block: 1.3em;
      margin-inline: 0;
      padding-inline-start: 1.15em;
      border-inline-start: 2px solid color-mix(in srgb, ${t.ink} 24%, transparent);
      color: color-mix(in srgb, ${t.ink} 84%, ${t.bg});
    }
    blockquote p { text-indent: 0; margin-block: 0.4em; }
    figure { margin-inline: 0; text-align: center; }
    figcaption { font-size: 0.82em; opacity: 0.7; margin-block-start: 0.5em; }
  `;

  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${s.readTheme === "dark" ? "dark" : "light"}; font-size: ${s.fontSize}px; background: ${t.bg}; color: ${t.ink}; }
    body { background: ${t.bg} !important; color: ${t.ink} !important; }
    p, li, blockquote, dd {
      line-height: ${s.lineHeight};
      text-align: ${justify ? "justify" : "start"};
      font-family: ${FONT_STACKS[s.font]};
      -webkit-hyphens: ${justify ? "auto" : "manual"};
      hyphens: ${justify ? "auto" : "manual"};
    }
    /* Breathing room added on top of the book's own indentation, never replacing it. */
    p { margin-block: ${s.paragraphSpacing}em; }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    [align="justify"] { text-align: justify; }
    ${embedded}
    a:link, a:visited { color: ${t.ink}; }
    pre { white-space: pre-wrap !important; }
  `;
}

export function Reader() {
  const activeBookId = useLibrary((s) => s.activeBookId);
  const books = useLibrary((s) => s.books);
  const storageRoot = useLibrary((s) => s.storageRoot);
  const goLibrary = useLibrary((s) => s.goLibrary);
  const consumePendingLocator = useLibrary((s) => s.consumePendingLocator);
  const settings = useReaderSettings();

  const book = books.find((b) => b.id === activeBookId) ?? null;

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStart = useRef(0);
  const pagesTurned = useRef(0);
  const prevFraction = useRef(0);

  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chapter, setChapter] = useState("");
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);

  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = settingsOpen || tocOpen;

  const revealChrome = useCallback(() => {
    setChromeHidden(false);
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    if (overlayOpenRef.current) return;
    chromeTimer.current = setTimeout(() => setChromeHidden(true), CHROME_IDLE_MS);
  }, []);

  // Open the book once per book id.
  useEffect(() => {
    if (!book || !storageRoot) return;
    let cancelled = false;
    let view: FoliateView | null = null;

    const onRelocate = (e: Event) => {
      const detail = (e as CustomEvent<RelocateDetail>).detail;
      const fraction = detail.fraction ?? 0;
      setProgress(fraction);
      if (detail.tocItem?.label) setChapter(detail.tocItem.label);
      if (fraction > prevFraction.current + 0.0005) pagesTurned.current += 1;
      prevFraction.current = fraction;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveReadingState(book.id, detail.cfi ?? null, fraction).catch(() => {});
      }, 800);
    };

    const onLoad = (e: Event) => {
      const doc = (e as CustomEvent<{ doc?: Document }>).detail?.doc;
      doc?.addEventListener("mousemove", revealChrome);
    };

    sessionStart.current = Math.floor(Date.now() / 1000);
    pagesTurned.current = 0;
    prevFraction.current = 0;

    (async () => {
      await import("../../../vendor/foliate-js/view.js");
      const url = bookUrl(book, storageRoot);
      if (!url || cancelled) return;
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], `book.${book.format}`);

      view = document.createElement("foliate-view") as FoliateView;
      hostRef.current?.appendChild(view);
      viewRef.current = view;
      await view.open(file);
      if (cancelled) return;

      view.addEventListener("relocate", onRelocate);
      view.addEventListener("load", onLoad);
      applyLayout(view, settings);
      view.renderer.setStyles?.(buildBookCss(settings));
      setToc(view.book?.toc ?? []);

      const pending = consumePendingLocator();
      if (pending) {
        const target = resolveTocTarget(view.book?.toc, pending);
        await view.goTo(target).catch(() => view?.renderer.next());
      } else {
        const saved = await getReadingState(book.id);
        if (saved?.locator) {
          await view.goTo(saved.locator).catch(() => view?.renderer.next());
        } else {
          view.renderer.next();
        }
      }
      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const end = Math.floor(Date.now() / 1000);
      if (sessionStart.current > 0 && end - sessionStart.current >= 3) {
        logSession(book.id, sessionStart.current, end, pagesTurned.current).catch(() => {});
      }
      view?.removeEventListener("relocate", onRelocate);
      view?.removeEventListener("load", onLoad);
      view?.remove();
      viewRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id, storageRoot]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !ready) return;
    applyLayout(view, settings);
    view.renderer.setStyles?.(buildBookCss(settings));
  }, [
    ready,
    settings.layout,
    settings.font,
    settings.fontSize,
    settings.lineHeight,
    settings.paragraphSpacing,
    settings.align,
    settings.readTheme,
  ]);

  // Keyboard paging.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen || tocOpen) return;
      if (e.key === "ArrowRight") viewRef.current?.next();
      else if (e.key === "ArrowLeft") viewRef.current?.prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, tocOpen]);

  // Auto-hide the chrome on idle; any pointer/key activity brings it back.
  useEffect(() => {
    if (!ready) return;
    const reveal = () => revealChrome();
    window.addEventListener("mousemove", reveal);
    window.addEventListener("keydown", reveal);
    reveal();
    return () => {
      window.removeEventListener("mousemove", reveal);
      window.removeEventListener("keydown", reveal);
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
    };
  }, [ready, revealChrome]);

  // Keep the chrome present the whole time a drawer is open.
  useEffect(() => {
    if (settingsOpen || tocOpen) {
      setChromeHidden(false);
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
    } else if (ready) {
      revealChrome();
    }
  }, [settingsOpen, tocOpen, ready, revealChrome]);

  if (!book) return null;

  const isPaged = settings.layout === "paged";
  const pct = Math.round(progress * 100);

  const goToToc = (href: string) => {
    setTocOpen(false);
    viewRef.current?.goTo(href).catch(() => {});
  };

  return (
    <div className={styles.reader} data-read-theme={settings.readTheme}>
      <div className={`${styles.topbar} ${chromeHidden ? styles.hidden : ""}`}>
        <div className={styles.topLeft}>
          <button type="button" className={styles.iconBtn} title="Library" onClick={goLibrary}>
            <ChevronLeft size={17} strokeWidth={1.8} />
          </button>
        </div>
        <div className={styles.heading}>
          <div className={styles.bookTitle}>{book.title}</div>
          <div className={styles.chapter}>{chapter || book.author}</div>
        </div>
        <div className={styles.topRight}>
          <button
            type="button"
            className={styles.iconBtn}
            title="Contents"
            onClick={() => setTocOpen(true)}
            disabled={toc.length === 0}
          >
            <List size={17} strokeWidth={1.8} />
          </button>
          <button type="button" className={styles.aaBtn} title="Display settings" onClick={() => setSettingsOpen(true)}>
            Aa
          </button>
        </div>
      </div>

      <div className={styles.stage}>
        <div ref={hostRef} className={styles.host} />
        {!ready && <div className={styles.loading}>Opening…</div>}
        <div
          className={styles.brightness}
          aria-hidden="true"
          style={{ opacity: (1 - settings.brightness) * 0.78 }}
        />
        {isPaged && ready && (
          <>
            <button
              type="button"
              aria-label="Previous page"
              className={`${styles.tapZone} ${styles.tapPrev}`}
              onClick={() => viewRef.current?.prev()}
            />
            <button
              type="button"
              aria-label="Next page"
              className={`${styles.tapZone} ${styles.tapNext}`}
              onClick={() => viewRef.current?.next()}
            />
          </>
        )}
      </div>

      <div className={`${styles.botbar} ${chromeHidden ? styles.hidden : ""}`}>
        {isPaged && (
          <button type="button" className={styles.iconBtn} onClick={() => viewRef.current?.prev()} title="Previous">
            <ChevronLeft size={16} strokeWidth={1.8} />
          </button>
        )}
        <span className={styles.pageLabel}>{chapter || "Reading"}</span>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={styles.pct}>{pct}%</span>
        {isPaged && (
          <button type="button" className={styles.iconBtn} onClick={() => viewRef.current?.next()} title="Next">
            <ChevronRight size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {tocOpen && (
        <>
          <div className={styles.scrim} onClick={() => setTocOpen(false)} />
          <div className={styles.toc}>
            <div className={styles.tocHead}>
              Contents
              <button type="button" className={styles.iconBtn} onClick={() => setTocOpen(false)} title="Close">
                <X size={14} strokeWidth={1.4} />
              </button>
            </div>
            <div className={styles.tocList}>
              {toc.map((item, i) => (
                <button
                  key={`${item.href}-${i}`}
                  type="button"
                  className={styles.tocItem}
                  onClick={() => goToToc(item.href)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {settingsOpen && <DisplaySettings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
