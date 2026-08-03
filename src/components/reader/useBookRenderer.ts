import { useEffect, useRef, useState } from "react";

import { messageOf } from "../../lib/errors";
import { getReadingState, recordSession, saveReadingState } from "../../lib/ipc";
import {
  type HighlightColors,
  type ReaderSettings,
  usePreferences,
} from "../../lib/preferences";
import type { Highlight } from "../../lib/types";
import type {
  ReaderEvent,
  ReaderPresentation,
  ReaderSession,
} from "../../reader/contract";
import { loadReaderFactory } from "../../reader/loadReader";
import { restoreReaderPosition } from "../../reader/navigation";
import { ReadingSession } from "../../reader/readingSession";
import type { RenderHighlight, SelectionDetail, TocItem } from "../../reader/types";
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

interface UseBookRendererOptions {
  activeBookId: string | null;
  settings: ReaderSettings;
  colors: HighlightColors;
  highlights: Highlight[];
  revealChrome: () => void;
}

export function useBookRenderer({
  activeBookId,
  settings,
  colors,
  highlights,
  revealChrome,
}: UseBookRendererOptions) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ReaderSession | null>(null);
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
    if (!activeBookId) return;
    const currentBook = useLibrary.getState().books.find((item) => item.id === activeBookId);
    if (!currentBook) return;

    let cancelled = false;
    let renderer: ReaderSession | null = null;
    let unsubscribe: (() => void) | null = null;
    const controller = new AbortController();

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

    const onSelection = (detail: SelectionDetail | null) => {
      setSelection(detail);
    };

    const onReaderEvent = (event: ReaderEvent) => {
      if (event.type === "relocate") onRelocate(event.detail);
      else if (event.type === "selection") onSelection(event.detail);
      else revealChromeRef.current();
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
      if (!hostRef.current || cancelled) return;
      const createReader = await loadReaderFactory();
      if (cancelled) return;

      renderer = createReader(hostRef.current);
      viewRef.current = renderer;
      unsubscribe = renderer.subscribe(onReaderEvent);
      const preferences = usePreferences.getState();
      const currentSettings = preferences.readerSettings;
      const currentColors = preferences.highlightColors;
      renderer.configure(toPresentation(currentSettings, currentColors));
      const contents = await renderer.open(currentBook.id);
      if (cancelled) return;

      setToc([...contents]);

      const pending = useLibrary.getState().consumePendingLocator();
      let displayed: boolean;
      if (pending) {
        displayed = await restoreReaderPosition(
          renderer,
          contents,
          pending,
          controller.signal,
        );
      } else {
        const saved = await getReadingState(currentBook.id);
        if (cancelled) return;
        displayed = await restoreReaderPosition(
          renderer,
          contents,
          saved?.locator ?? null,
          controller.signal,
        );
      }
      if (cancelled) return;
      if (!displayed) {
        throw new Error("The book does not have a section Novus can display");
      }
      restored.current = true;
      session.current = new ReadingSession(lastFraction.current);
      setReady(true);
    };

    void openBook().catch((error: unknown) => {
      if (cancelled || controller.signal.aborted) return;
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
      unsubscribe?.();
      renderer?.dispose();
      viewRef.current = null;
      setReady(false);
    };
  }, [activeBookId]);

  useEffect(() => {
    const renderer = viewRef.current;
    if (!renderer || !ready) return;
    renderer.configure(toPresentation(settings, colors));
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
    renderer.replaceHighlights(list, pendingNewId.current ?? undefined);
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
