import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, List, X } from "lucide-react";

import { bookUrl } from "../../lib/assets";
import { getReadingState, logSession, saveReadingState } from "../../lib/ipc";
import { NovusRenderer } from "../../reader/NovusRenderer";
import type { TocItem } from "../../reader/types";
import { FONT_STACKS, useReaderSettings, type ReaderSettings } from "../../store/reader";
import { useLibrary } from "../../store/library";
import { DisplaySettings } from "./DisplaySettings";
import styles from "./Reader.module.css";

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

function applyLayout(renderer: NovusRenderer, s: ReaderSettings): void {
  renderer.setFlow(s.layout === "paged" ? "paginated" : "scrolled");
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
      color: color-mix(in srgb, ${t.ink} 84%, ${t.bg}) !important;
    }
    blockquote p { text-indent: 0; margin-block: 0.4em; }
    figure { margin-inline: 0; text-align: center; }
    figcaption { font-size: 0.82em; opacity: 0.7; margin-block-start: 0.5em; }
  `;

  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${s.readTheme === "dark" ? "dark" : "light"}; font-size: ${s.fontSize}px; background: ${t.bg} !important; color: ${t.ink} !important; }
    body { background: ${t.bg} !important; color: ${t.ink} !important; }
    body :where(p, li, dd, dt, ol, ul, dl, h1, h2, h3, h4, h5, h6, span, em, strong,
      b, i, u, s, small, sub, sup, mark, cite, q, abbr, time, address, div, section,
      article, header, footer, aside, main, nav, table, thead, tbody, tr, td, th,
      caption, figure, figcaption, hr, label) {
      color: inherit !important;
      background-color: transparent !important;
    }
    p, li, dd, dt, blockquote, td, th {
      font-family: ${FONT_STACKS[s.font]} !important;
      font-size: ${s.fontSize}px !important;
      line-height: ${s.lineHeight} !important;
      text-align: ${justify ? "justify" : "start"};
      -webkit-hyphens: ${justify ? "auto" : "manual"};
      hyphens: ${justify ? "auto" : "manual"};
    }
    caption, figcaption {
      font-family: ${FONT_STACKS[s.font]} !important;
      line-height: ${s.lineHeight} !important;
    }
    p { margin-block: ${s.paragraphSpacing}em; }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    [align="justify"] { text-align: justify; }
    ${embedded}
    a:link, a:visited { color: ${t.ink} !important; }
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
  const viewRef = useRef<NovusRenderer | null>(null);
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
    let renderer: NovusRenderer | null = null;

    const onRelocate = (detail: import("../../reader/types").RelocateDetail) => {
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

    const onLoad = (detail: import("../../reader/types").LoadDetail) => {
      detail.doc?.addEventListener("mousemove", revealChrome);
    };

    sessionStart.current = Math.floor(Date.now() / 1000);
    pagesTurned.current = 0;
    prevFraction.current = 0;

    (async () => {
      const url = bookUrl(book, storageRoot);
      if (!url || !hostRef.current || cancelled) return;
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], `book.${book.format}`);

      renderer = new NovusRenderer(hostRef.current);
      viewRef.current = renderer;
      renderer.on("relocate", onRelocate);
      renderer.on("load", onLoad);
      await renderer.open(file);
      if (cancelled) {
        renderer.destroy();
        return;
      }

      applyLayout(renderer, settings);
      renderer.setStyles(buildBookCss(settings));
      setToc(renderer.toc);

      const pending = consumePendingLocator();
      if (pending) {
        const target = resolveTocTarget(renderer.toc, pending);
        if (!(await renderer.goTo(target))) await renderer.resetPosition();
      } else {
        const saved = await getReadingState(book.id);
        if (saved?.locator) {
          if (!(await renderer.goTo(saved.locator))) await renderer.resetPosition();
        } else {
          await renderer.resetPosition();
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
      renderer?.destroy();
      viewRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id, storageRoot]);

  useEffect(() => {
    const renderer = viewRef.current;
    if (!renderer || !ready) return;
    applyLayout(renderer, settings);
    renderer.setStyles(buildBookCss(settings));
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
        {ready && (
          <>
            <button
              type="button"
              aria-label="Previous page"
              className={`${styles.navBtn} ${styles.navPrev} ${chromeHidden ? styles.hidden : ""}`}
              onClick={() => viewRef.current?.prev()}
            >
              <ChevronLeft size={22} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="Next page"
              className={`${styles.navBtn} ${styles.navNext} ${chromeHidden ? styles.hidden : ""}`}
              onClick={() => viewRef.current?.next()}
            >
              <ChevronRight size={22} strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>

      <div className={`${styles.botbar} ${chromeHidden ? styles.hidden : ""}`}>
        <button type="button" className={styles.iconBtn} onClick={() => viewRef.current?.prev()} title="Previous">
          <ChevronLeft size={16} strokeWidth={1.8} />
        </button>
        <span className={styles.pageLabel}>{chapter || "Reading"}</span>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={styles.pct}>{pct}%</span>
        <button type="button" className={styles.iconBtn} onClick={() => viewRef.current?.next()} title="Next">
          <ChevronRight size={16} strokeWidth={1.8} />
        </button>
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
