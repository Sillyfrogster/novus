import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MoreHorizontal, X } from "lucide-react";

import { coverUrl } from "../../lib/assets";
import { usePreferences } from "../../lib/preferences";
import { useDialog } from "../../lib/useDialog";
import {
  copyImage,
  copyText,
  fileStem,
  formatMarkdown,
  formatObsidian,
  formatPlain,
  saveImageFile,
  saveTextFile,
} from "../../lib/highlightExport";
import type { Book, Highlight } from "../../lib/types";
import { useHighlightGroups, useHighlights } from "../../store/highlights";
import { useLibrary } from "../../store/library";
import { DetailOverview } from "./DetailOverview";
import { HighlightContextMenu } from "./HighlightContextMenu";
import { encodeHighlightCard, renderHighlightCard } from "./HighlightShareCard";
import { spineLook } from "./spineLook";
import styles from "./DetailModal.module.css";

type DetailTab = "overview" | "highlights";

function highlightDate(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const UNDO_MS = 6000;

const GROW_MS = 360;

type GrowPhase = "enter" | "open" | "closing";

interface DetailModalProps {
  book: Book;
  storageRoot: string;
  originRect: DOMRect | null;
  onClose: () => void;
  onRead: (book: Book, locator?: string) => void;
  onRemove: (book: Book) => void;
}
function collapsedTransform(rect: DOMRect | null): string {
  if (!rect) return "translate(-50%, -50%) scale(0.94)";
  const modalW = Math.min(1000, window.innerWidth - 120);
  const dx = rect.left + rect.width / 2 - window.innerWidth / 2;
  const dy = rect.top + rect.height / 2 - window.innerHeight / 2;
  const scale = Math.max(0.04, rect.width / modalW);
  return `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${scale})`;
}

/** Expanded view of a single book */
export function DetailModal({
  book,
  storageRoot,
  originRect,
  onClose,
  onRead,
  onRemove,
}: DetailModalProps) {
  const [phase, setPhase] = useState<GrowPhase>("enter");
  const modalRef = useDialog();

  const highlights = useHighlights((s) => s.highlights);
  const groups = useHighlightGroups();
  const highlightStatus = useHighlights((s) => s.status);
  const colors = usePreferences((s) => s.highlightColors);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [menu, setMenu] = useState<{ x: number; y: number; h: Highlight } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [undo, setUndo] = useState<Highlight | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load this book's highlights for the Highlights tab.
  useEffect(() => {
    useHighlights.getState().loadFor(book.id);
  }, [book.id]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const removeHighlight = async (h: Highlight) => {
    const removed = await useHighlights.getState().remove(h.id);
    if (!removed) {
      showActionNotice("Novus could not remove this highlight.", "error");
      return;
    }
    setExpandedId((id) => (id === h.id ? null : id));
    setUndo(removed);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const restoreHighlight = async () => {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (await useHighlights.getState().restore(undo)) {
      setUndo(null);
    } else {
      showActionNotice("Novus could not restore this highlight.", "error");
    }
  };

  const showActionNotice = (text: string, tone: "error" | "success") => {
    useLibrary.getState().showAppNotice({ text, tone, persistent: false });
  };

  const copyHighlightText = async (h: Highlight) => {
    const copied = await copyText(formatPlain(h, book));
    showActionNotice(
      copied ? "Highlight copied." : "Novus could not copy this highlight.",
      copied ? "success" : "error",
    );
  };

  const copyHighlightImage = async (h: Highlight) => {
    try {
      const canvas = await renderHighlightCard(h, book);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas unavailable");
      const copied = await copyImage(
        context.getImageData(0, 0, canvas.width, canvas.height),
      );
      showActionNotice(
        copied ? "Highlight image copied." : "Novus could not copy this image. Try saving it instead.",
        copied ? "success" : "error",
      );
    } catch {
      showActionNotice("Novus could not create this image.", "error");
    }
  };

  const saveHighlightImage = async (h: Highlight) => {
    try {
      const canvas = await renderHighlightCard(h, book);
      const blob = await encodeHighlightCard(canvas);
      const saved = await saveImageFile(blob, `${fileStem(book)}-highlight.png`);
      if (saved) showActionNotice("Highlight image saved.", "success");
    } catch {
      showActionNotice("Novus could not save this image. Please try again.", "error");
    }
  };

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(id);
  }, []);

  // Dismissals run the reverse animation, then unmount once it settles.
  const requestClose = () => {
    if (phase === "closing") return;
    setPhase("closing");
    window.setTimeout(onClose, GROW_MS);
  };

  const cover = coverUrl(book, storageRoot);
  const look = spineLook(book);

  const collapsed = phase === "enter" || phase === "closing";
  const modalStyle = {
    transform: collapsed ? collapsedTransform(originRect) : "translate(-50%, -50%)",
    opacity: collapsed ? 0 : 1,
  };

  return (
    <>
      <dialog
        ref={modalRef}
        className={styles.modal}
        style={modalStyle}
        aria-label={book.title}
        data-closing={phase === "closing"}
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
      >
        <button
          type="button"
          className={styles.modalClose}
          onClick={requestClose}
          title="Close"
          aria-label="Close book details"
        >
          <X size={14} strokeWidth={1.4} />
        </button>

        <div className={styles.modalCover}>
          <div
            className={styles.coverArt}
            style={
              cover
                ? { backgroundImage: `url(${cover})`, color: "transparent" }
                : { background: look.bg, color: look.fg }
            }
          >
            {!cover && (
              <>
                <span className={styles.coverFallTitle}>{book.title}</span>
                <span className={styles.coverFallAuthor}>{book.author}</span>
              </>
            )}
          </div>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.modalEyebrow}>
            {book.format.toUpperCase()}
            {book.language ? ` · ${book.language.toUpperCase()}` : ""}
          </div>
          <h2 className={styles.modalTitle}>{book.title}</h2>
          <div className={styles.modalAuthor}>{book.author}</div>

          <div className={styles.tabs} role="tablist" aria-label="Book detail sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "overview"}
              className={`${styles.tab} ${tab === "overview" ? styles.tabOn : ""}`}
              onClick={() => setTab("overview")}
            >
              Overview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "highlights"}
              className={`${styles.tab} ${tab === "highlights" ? styles.tabOn : ""}`}
              onClick={() => setTab("highlights")}
            >
              Highlights{highlights.length ? ` · ${highlights.length}` : ""}
            </button>
          </div>

          <div hidden={tab !== "overview"}>
            <DetailOverview key={book.id} book={book} onRead={onRead} onRemove={onRemove} />
          </div>

          {tab === "highlights" && (
            <div className={styles.hlTab}>
              {highlightStatus === "loading" && highlights.length === 0 ? (
                <div className={styles.hlEmpty} role="status">
                  <p className={styles.hlEmptyLead}>Loading highlights…</p>
                </div>
              ) : highlightStatus === "error" && highlights.length === 0 ? (
                <div className={styles.hlEmpty} role="alert">
                  <p className={styles.hlEmptyLead}>Novus could not load these highlights.</p>
                  <p className={styles.hlEmptyHint}>Close this view and try again.</p>
                </div>
              ) : highlights.length === 0 ? (
                <div className={styles.hlEmpty}>
                  <p className={styles.hlEmptyLead}>No highlights yet.</p>
                  <p className={styles.hlEmptyHint}>
                    Open the book and select any passage to keep it here.
                  </p>
                </div>
              ) : (
                groups.map((group, gi) => (
                  <section key={`${group.label}-${gi}`} className={styles.hlGroup}>
                    <div className={styles.hlChapter}>{group.label}</div>
                    {group.items.map((h) => (
                      <div
                        key={h.id}
                        className={styles.hlRow}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setMenu({ x: event.clientX, y: event.clientY, h });
                        }}
                      >
                        <div className={styles.hlRowTop}>
                          <button
                            type="button"
                            className={styles.hlMain}
                            onClick={() => onRead(book, h.cfi)}
                            title="Open at this highlight"
                          >
                            <span
                              className={styles.hlTick}
                              style={{ background: colors[h.color]?.color ?? colors.slate.color }}
                              aria-hidden="true"
                            />
                            <span className={styles.hlText}>{h.text}</span>
                          </button>
                          <button
                            type="button"
                            className={styles.hlMore}
                            aria-label="More actions for this highlight"
                            title="More actions"
                            onClick={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              setMenu({ x: rect.right, y: rect.bottom + 4, h });
                            }}
                          >
                            <MoreHorizontal size={16} strokeWidth={1.7} />
                          </button>
                        </div>
                        {expandedId === h.id && (
                          <dl className={styles.hlDetails}>
                            <dt>When</dt>
                            <dd>{highlightDate(h.createdAt)}</dd>
                            <dt>Color</dt>
                            <dd>{colors[h.color]?.label ?? h.color}</dd>
                            <dt>Where</dt>
                            <dd>
                              {[h.chapterLabel?.trim(), h.location != null ? `Location ${h.location + 1}` : null]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </dd>
                            {h.note && (
                              <>
                                <dt>Why</dt>
                                <dd>{h.note}</dd>
                              </>
                            )}
                          </dl>
                        )}
                      </div>
                    ))}
                  </section>
                ))
              )}
            </div>
          )}
        </div>

        {undo && (
          <div className={styles.undo} role="status">
            Highlight removed
            <button type="button" className={styles.undoBtn} onClick={restoreHighlight}>
              Undo
            </button>
          </div>
        )}
      </dialog>

      {menu && (
        <HighlightContextMenu
          x={menu.x}
          y={menu.y}
          onDetails={() =>
            setExpandedId((id) => (id === menu.h.id ? null : menu.h.id))
          }
          onCopy={() => copyHighlightText(menu.h)}
          onCopyImage={() => copyHighlightImage(menu.h)}
          onSaveImage={() => saveHighlightImage(menu.h)}
          onExportMarkdown={() =>
            saveTextFile(
              formatMarkdown(menu.h, book),
              `${fileStem(book)}-highlight.md`,
              "Markdown",
              "md",
            )
          }
          onExportObsidian={() =>
            saveTextFile(
              formatObsidian(menu.h, book),
              `${fileStem(book)}-highlight.md`,
              "Markdown",
              "md",
            )
          }
          onDelete={() => removeHighlight(menu.h)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
