import { useCallback, useEffect, useRef, useState } from "react";

import { messageOf } from "../../lib/errors";
import { recordSession, saveReadingState } from "../../lib/ipc";
import {
  type HighlightColors,
  type ReaderSettings,
  usePreferences,
} from "../../lib/preferences";
import type { HighlightColorKey } from "../../lib/types";
import type {
  ReaderEngine,
  ReaderEvent,
  ReaderPresentation,
} from "../../reader/contract";
import { ReadingSession } from "../../reader/readingSession";
import type {
  RelocateDetail,
  RenderHighlight,
  SelectionDetail,
  TocItem,
} from "../../reader/types";
import { useHighlights } from "../../store/highlights";
import { useLibrary } from "../../store/library";

const DWELL_SAVE_MS = 3000;
const UNMOUNT_SAVE_MIN_DWELL_MS = 1500;
const SESSION_FLUSH_MS = 60_000;

function toPresentation(
  settings: ReaderSettings,
  colors: HighlightColors,
): ReaderPresentation {
  return {
    readTheme: settings.readTheme,
    font: settings.font,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    measure: settings.measure,
    paragraphSpacing: settings.paragraphSpacing,
    align: settings.align,
    layout: settings.layout,
    highlightColors: {
      slate: colors.slate.color,
      sage: colors.sage.color,
      violet: colors.violet.color,
      rose: colors.rose.color,
    },
  };
}

interface UseReadingSessionOptions {
  activeBookId: string | null;
  settings: ReaderSettings;
  colors: HighlightColors;
  revealChrome: () => void;
}

export function useReadingSession({
  activeBookId,
  settings,
  colors,
  revealChrome,
}: UseReadingSessionOptions) {
  const highlights = useHighlights((state) => state.highlights);
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ReaderEngine | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ cfi: string | null; fraction: number } | null>(null);
  const lastMoveAt = useRef(0);
  const restored = useRef(false);
  const activitySession = useRef<ReadingSession | null>(null);
  const lastFraction = useRef(0);
  const emphasizedHighlight = useRef<string | null>(null);
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
    if (!activeBookId) return;
    const currentBook = useLibrary.getState().books.find((item) => item.id === activeBookId);
    if (!currentBook) return;

    let cancelled = false;
    let renderer: ReaderEngine | null = null;
    let unsubscribe: (() => void) | null = null;

    setReady(false);
    setProgress(0);
    setLocation(null);
    setChapter("");
    setToc([]);
    setSelection(null);

    const onRelocate = (detail: RelocateDetail) => {
      const fraction = detail.fraction ?? 0;
      setProgress(fraction);
      setLocation(detail.location ?? null);
      setChapter(detail.tocItem?.label ?? "");
      lastFraction.current = fraction;
      if (!restored.current || detail.reason === "layout") return;
      activitySession.current?.add(fraction, detail.reason);
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

    const onReaderEvent = (event: ReaderEvent) => {
      if (event.type === "relocate") onRelocate(event.detail);
      else if (event.type === "selection") setSelection(event.detail);
      else revealChromeRef.current();
    };

    lastFraction.current = 0;
    restored.current = false;
    pendingSave.current = null;
    activitySession.current = null;
    emphasizedHighlight.current = null;

    const flushSession = () => {
      const record = activitySession.current?.toRecord(currentBook.id);
      if (record) recordSession(record).catch(() => {});
    };
    const flushTimer = setInterval(flushSession, SESSION_FLUSH_MS);

    const openBook = async () => {
      if (!hostRef.current || cancelled) return;
      const { NovusRenderer } = await import("../../reader/NovusRenderer");
      if (cancelled) return;
      const pending = useLibrary.getState().consumePendingLocator();

      renderer = new NovusRenderer(hostRef.current);
      rendererRef.current = renderer;
      unsubscribe = renderer.subscribe(onReaderEvent);
      const preferences = usePreferences.getState();
      const currentSettings = preferences.readerSettings;
      const currentColors = preferences.highlightColors;
      renderer.configure(toPresentation(currentSettings, currentColors));
      const contents = await renderer.open(currentBook.id, pending);
      if (cancelled) return;

      setToc([...contents]);
      restored.current = true;
      activitySession.current = new ReadingSession(lastFraction.current);
      setReady(true);
    };

    void openBook().catch((error: unknown) => {
      if (cancelled) return;
      const detail = messageOf(error);
      useLibrary.setState({
        error:
          detail === "Novus could not open this book"
            ? detail
            : `Novus could not open this book. ${detail}`,
        view: "library",
        activeBookId: null,
        pendingLocator: null,
      });
    });

    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const pending = pendingSave.current;
      if (pending && Date.now() - lastMoveAt.current >= UNMOUNT_SAVE_MIN_DWELL_MS) {
        saveReadingState(currentBook.id, pending.cfi, pending.fraction).catch(() => {});
      }
      pendingSave.current = null;
      clearInterval(flushTimer);
      flushSession();
      activitySession.current = null;
      unsubscribe?.();
      renderer?.dispose();
      rendererRef.current = null;
      setReady(false);
    };
  }, [activeBookId]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !ready) return;
    renderer.configure(toPresentation(settings, colors));
  }, [ready, settings, colors]);

  useEffect(() => {
    if (activeBookId) void useHighlights.getState().loadFor(activeBookId);
  }, [activeBookId]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !ready) return;
    const list: RenderHighlight[] = highlights.map((highlight) => ({
      id: highlight.id,
      cfi: highlight.cfi,
      color: highlight.color,
      sectionIndex: highlight.sectionIndex,
    }));
    const newId = emphasizedHighlight.current;
    const emphasize = newId && highlights.some((highlight) => highlight.id === newId)
      ? newId
      : undefined;
    renderer.replaceHighlights(list, emphasize);
    if (emphasize) emphasizedHighlight.current = null;
  }, [ready, highlights]);

  const turn = useCallback((direction: "next" | "previous") => {
    rendererRef.current?.turn(direction);
  }, []);

  const goTo = useCallback((target: string) => {
    const renderer = rendererRef.current;
    if (renderer) void renderer.navigate({ kind: "target", value: target }).catch(() => {});
  }, []);

  const goToHighlight = useCallback((cfi: string) => {
    const renderer = rendererRef.current;
    if (renderer) void renderer.navigate({ kind: "highlight", value: cfi }).catch(() => {});
  }, []);

  const dismissSelection = useCallback(() => {
    rendererRef.current?.clearSelection();
    setSelection(null);
  }, []);

  const captureSelection = useCallback(
    async (color: HighlightColorKey): Promise<string | null> => {
      if (!activeBookId || !selection?.cfi) return null;
      const id = crypto.randomUUID();
      emphasizedHighlight.current = id;
      const saving = useHighlights.getState().capture({
        id,
        bookId: activeBookId,
        cfi: selection.cfi,
        text: selection.text,
        chapterLabel: chapter || null,
        chapterHref: null,
        sectionIndex: selection.sectionIndex,
        location: location?.current ?? null,
        color,
      });
      dismissSelection();
      const saved = await saving;
      if (saved && useLibrary.getState().activeBookId === activeBookId) return saved.id;
      if (emphasizedHighlight.current === id) emphasizedHighlight.current = null;
      if (!saved) {
        useLibrary.getState().showAppNotice({
          text: "Novus could not save this highlight.",
          tone: "error",
          persistent: false,
        });
      }
      return null;
    },
    [activeBookId, chapter, dismissSelection, location?.current, selection],
  );

  return {
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
  };
}
