import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Highlighter, List, X } from "lucide-react";

import { usePreferences } from "../../lib/preferences";
import type { HighlightColorKey } from "../../lib/types";
import { useHighlights } from "../../store/highlights";
import { useLibrary } from "../../store/library";
import { DisplaySettings } from "./DisplaySettings";
import { HighlightBar } from "./HighlightBar";
import { HighlightsPanel } from "./HighlightsPanel";
import { useReadingSession } from "./useReadingSession";
import { WhyBox } from "./WhyBox";
import styles from "./Reader.module.css";

const CHROME_IDLE_MS = 2600;

export function Reader() {
  const activeBookId = useLibrary((s) => s.activeBookId);
  const books = useLibrary((s) => s.books);
  const goLibrary = useLibrary((s) => s.goLibrary);
  const settings = usePreferences((s) => s.readerSettings);
  const colors = usePreferences((s) => s.highlightColors);

  const book = books.find((b) => b.id === activeBookId) ?? null;

  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [whyForId, setWhyForId] = useState<string | null>(null);

  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayOpenRef = useRef(false);

  useEffect(() => {
    overlayOpenRef.current = settingsOpen || tocOpen || panelOpen;
  }, [settingsOpen, tocOpen, panelOpen]);

  const revealChrome = useCallback(() => {
    setChromeHidden(false);
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    if (overlayOpenRef.current) return;
    chromeTimer.current = setTimeout(() => setChromeHidden(true), CHROME_IDLE_MS);
  }, []);

  const {
    hostRef,
    ready,
    progress,
    location,
    chapter,
    toc,
    selection,
    turn,
    goTo,
    goToHighlight,
    captureSelection,
    dismissSelection,
  } = useReadingSession({
    activeBookId,
    settings,
    colors,
    revealChrome,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen || tocOpen || panelOpen || selection || whyForId) return;
      if (e.key === "ArrowRight") turn("next");
      else if (e.key === "ArrowLeft") turn("previous");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, tocOpen, panelOpen, selection, turn, whyForId]);

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
    if (settingsOpen || tocOpen || panelOpen) {
      setChromeHidden(false);
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
    } else if (ready) {
      revealChrome();
    }
  }, [settingsOpen, tocOpen, panelOpen, ready, revealChrome]);

  if (!book) return null;

  const pct = Math.round(progress * 100);
  const pageLabel =
    location && location.total > 0
      ? `Page ${Math.min(location.total, location.current + 1)} of ${location.total}`
      : chapter || "Reading";

  const goToToc = (href: string) => {
    setTocOpen(false);
    goTo(href);
  };

  const onPickColor = async (color: HighlightColorKey) => {
    const id = await captureSelection(color);
    if (id) setWhyForId(id);
  };

  const jumpToHighlight = (cfi: string) => {
    setPanelOpen(false);
    goToHighlight(cfi);
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
          <button
            type="button"
            className={styles.iconBtn}
            title="Highlights"
            onClick={() => setPanelOpen(true)}
          >
            <Highlighter size={17} strokeWidth={1.8} />
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
              onClick={() => turn("previous")}
            >
              <ChevronLeft size={22} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="Next page"
              className={`${styles.navBtn} ${styles.navNext} ${chromeHidden ? styles.hidden : ""}`}
              onClick={() => turn("next")}
            >
              <ChevronRight size={22} strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>

      <div className={`${styles.botbar} ${chromeHidden ? styles.hidden : ""}`}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => turn("previous")}
          title="Previous"
        >
          <ChevronLeft size={16} strokeWidth={1.8} />
        </button>
        <span className={styles.pageLabel}>{pageLabel}</span>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={styles.pct}>{pct}%</span>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => turn("next")}
          title="Next"
        >
          <ChevronRight size={16} strokeWidth={1.8} />
        </button>
      </div>

      {tocOpen && (
        <>
          <button
            type="button"
            className={styles.scrim}
            aria-label="Close table of contents"
            onClick={() => setTocOpen(false)}
          />
          <div className={styles.toc}>
            <div className={styles.tocHead}>
              Contents
              <button type="button" className={styles.iconBtn} onClick={() => setTocOpen(false)} title="Close">
                <X size={14} strokeWidth={1.4} />
              </button>
            </div>
            <div className={styles.tocList}>
              {toc.map((item) => (
                <button
                  key={item.href}
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

      {panelOpen && (
        <HighlightsPanel onJump={jumpToHighlight} onClose={() => setPanelOpen(false)} />
      )}

      {selection && (
        <HighlightBar
          rect={selection.rect}
          colors={colors}
          onPick={onPickColor}
          onDismiss={dismissSelection}
        />
      )}

      {whyForId && (
        <WhyBox
          onSave={(note) => {
            useHighlights.getState().updateNote(whyForId, note);
            setWhyForId(null);
          }}
          onDismiss={() => setWhyForId(null)}
        />
      )}
    </div>
  );
}
