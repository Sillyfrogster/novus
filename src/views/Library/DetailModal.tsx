import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Play, RotateCcw, Trash2, X } from "lucide-react";

import { coverUrl } from "../../lib/assets";
import { bookToc } from "../../lib/ipc";
import {
  copyText,
  fileStem,
  formatMarkdown,
  formatObsidian,
  formatPlain,
  saveImageFile,
  saveTextFile,
} from "../../lib/highlightExport";
import type { Book, Highlight, TocEntry } from "../../lib/types";
import { useHighlights } from "../../store/highlights";
import { useLibrary } from "../../store/library";
import { HighlightContextMenu } from "./HighlightContextMenu";
import { renderHighlightCard } from "./HighlightShareCard";
import { spineLook } from "./spineLook";
import styles from "./DetailModal.module.css";

type DetailTab = "overview" | "highlights";

interface ChapterGroup {
  label: string;
  items: Highlight[];
}

function groupByChapter(highlights: Highlight[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  for (const h of highlights) {
    const label = h.chapterLabel?.trim() || "Unlabeled";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(h);
    else groups.push({ label, items: [h] });
  }
  return groups;
}

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
const TOC_COLLAPSED = 8;

function collapsedTransform(rect: DOMRect | null): string {
  if (!rect) return "translate(-50%, -50%) scale(0.94)";
  const modalW = Math.min(1000, window.innerWidth - 120);
  const dx = rect.left + rect.width / 2 - window.innerWidth / 2;
  const dy = rect.top + rect.height / 2 - window.innerHeight / 2;
  const scale = Math.max(0.04, rect.width / modalW);
  return `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${scale})`;
}

function addedDate(addedAt: number): string {
  return new Date(addedAt * 1000).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function statusLabel(progress: number): string {
  if (progress >= 1) return "Finished";
  if (progress > 0) return `${Math.round(progress * 100)}% read`;
  return "Not started";
}

function readLabel(progress: number): string {
  if (progress >= 1) return "Read again";
  if (progress > 0) return "Continue reading";
  return "Start reading";
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
  const collections = useLibrary((s) => s.collections);
  const toggleMembership = useLibrary((s) => s.toggleMembership);
  const addCollection = useLibrary((s) => s.addCollection);
  const resetProgress = useLibrary((s) => s.resetProgress);
  const [progress, setProgress] = useState(book.progress);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [toc, setToc] = useState<TocEntry[] | null>(null);
  const [tocExpanded, setTocExpanded] = useState(false);
  const [phase, setPhase] = useState<GrowPhase>("enter");
  const modalRef = useRef<HTMLDivElement>(null);

  const highlights = useHighlights((s) => s.highlights);
  const colors = useHighlights((s) => s.colors);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [menu, setMenu] = useState<{ x: number; y: number; h: Highlight } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [undo, setUndo] = useState<Highlight | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groups = useMemo(() => groupByChapter(highlights), [highlights]);

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
    await useHighlights.getState().remove(h.id);
    setExpandedId((id) => (id === h.id ? null : id));
    setUndo(h);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const restoreHighlight = () => {
    if (undo) useHighlights.getState().restore(undo);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
  };

  const shareImage = async (h: Highlight) => {
    try {
      const blob = await renderHighlightCard(h, book);
      await saveImageFile(blob, `${fileStem(book)}-highlight.png`);
    } catch {
      // cancelled or render failure
    }
  };

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
        return;
      }
      if (e.key !== "Tab" || !modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parse the chapter list lazily
  useEffect(() => {
    let active = true;
    bookToc(book.id)
      .then((entries) => active && setToc(entries))
      .catch(() => active && setToc([]));
    return () => {
      active = false;
    };
  }, [book.id]);

  // Dismissals run the reverse animation, then unmount once it settles.
  const requestClose = () => {
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

  const submitNew = () => {
    if (newName.trim()) addCollection(newName);
    setNewName("");
    setNewOpen(false);
  };

  return (
    <>
      <div
        className={styles.backdrop}
        style={{ opacity: phase === "closing" ? 0 : 1 }}
        onClick={requestClose}
      />
      <div
        ref={modalRef}
        tabIndex={-1}
        className={styles.modal}
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-label={book.title}
      >
        <button type="button" className={styles.modalClose} onClick={requestClose} title="Close">
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

          {tab === "overview" && (
            <>
          {book.description && <p className={styles.modalSynopsis}>{book.description}</p>}

          <div className={styles.metaRow}>
            <span className={styles.metaFacts}>
              {statusLabel(progress)}
              {toc?.length ? ` · ${toc.length} chapters` : ""} · Added {addedDate(book.addedAt)}
            </span>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.readBtn} onClick={() => onRead(book)}>
              <Play size={14} fill="currentColor" strokeWidth={0} />
              {readLabel(progress)}
            </button>
            <div className={styles.iconActions}>
              {progress > 0 && (
                <button
                  type="button"
                  className={styles.resetBtn}
                  onClick={async () => {
                    await resetProgress(book.id);
                    setProgress(0);
                  }}
                  title="Reset reading progress"
                  aria-label="Reset reading progress"
                >
                  <RotateCcw size={15} strokeWidth={1.7} />
                </button>
              )}
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => onRemove(book)}
                title="Remove from library"
                aria-label="Remove from library"
              >
                <Trash2 size={15} strokeWidth={1.7} />
              </button>
            </div>
          </div>

          <div className={styles.tocSection}>
            <div className={styles.modalEyebrow} style={{ marginBottom: 12 }}>
              Chapters
            </div>
            {toc === null ? (
              <div className={styles.chipsEmpty}>Reading chapters…</div>
            ) : toc.length === 0 ? (
              <div className={styles.chipsEmpty}>No chapter list available.</div>
            ) : (
              <>
                <ol className={styles.tocList}>
                  {(tocExpanded ? toc : toc.slice(0, TOC_COLLAPSED)).map((entry, i) => (
                    <li key={`${entry.href}-${i}`}>
                      <button
                        type="button"
                        className={styles.tocItem}
                        style={{ paddingLeft: 10 + entry.depth * 16 }}
                        onClick={() => onRead(book, entry.href)}
                        disabled={!entry.href}
                      >
                        <span className={styles.tocNum}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className={styles.tocLabel}>{entry.label}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                {toc.length > TOC_COLLAPSED && (
                  <button
                    type="button"
                    className={styles.tocMore}
                    onClick={() => setTocExpanded((v) => !v)}
                  >
                    {tocExpanded ? "Show fewer" : `Show all ${toc.length} chapters`}
                  </button>
                )}
              </>
            )}
          </div>

          <div className={styles.collSection}>
            <div className={styles.collSectionHead}>
              <span className={styles.modalEyebrow} style={{ marginBottom: 0 }}>
                Collections
              </span>
              <button type="button" className={styles.collNew} onClick={() => setNewOpen((v) => !v)}>
                + New
              </button>
            </div>
            <div className={styles.chips}>
              {collections.length === 0 && !newOpen && (
                <span className={styles.chipsEmpty}>No collections yet.</span>
              )}
              {collections.map((c) => {
                const member = c.bookIds.includes(book.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.chip} ${member ? styles.chipOn : ""}`}
                    onClick={() => toggleMembership(c.id, book.id, !member)}
                  >
                    {member && (
                      <Check size={11} strokeWidth={2.4} />
                    )}
                    {c.name}
                  </button>
                );
              })}
            </div>
            {newOpen && (
              <input
                autoFocus
                className={styles.chipInput}
                placeholder="Collection name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNew();
                  else if (e.key === "Escape") setNewOpen(false);
                }}
                onBlur={submitNew}
              />
            )}
          </div>
            </>
          )}

          {tab === "highlights" && (
            <div className={styles.hlTab}>
              {highlights.length === 0 ? (
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
                      <div key={h.id} className={styles.hlRow}>
                        <button
                          type="button"
                          className={styles.hlMain}
                          onClick={() => onRead(book, h.cfi)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, h });
                          }}
                          title="Open at this highlight  (right-click for more)"
                        >
                          <span
                            className={styles.hlTick}
                            style={{ background: colors[h.color]?.color ?? colors.slate.color }}
                            aria-hidden="true"
                          />
                          <span className={styles.hlText}>{h.text}</span>
                        </button>
                        {expandedId === h.id && (
                          <dl className={styles.hlDetails}>
                            <div>
                              <dt>When</dt>
                              <dd>{highlightDate(h.createdAt)}</dd>
                            </div>
                            <div>
                              <dt>Color</dt>
                              <dd>{colors[h.color]?.label ?? h.color}</dd>
                            </div>
                            <div>
                              <dt>Where</dt>
                              <dd>
                                {[h.chapterLabel?.trim(), h.location != null ? `Location ${h.location + 1}` : null]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </dd>
                            </div>
                            {h.note && (
                              <div>
                                <dt>Why</dt>
                                <dd>{h.note}</dd>
                              </div>
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
      </div>

      {menu && (
        <HighlightContextMenu
          x={menu.x}
          y={menu.y}
          onDetails={() => setExpandedId((id) => (id === menu.h.id ? null : menu.h.id))}
          onCopy={() => copyText(formatPlain(menu.h, book))}
          onShareImage={() => shareImage(menu.h)}
          onExportMarkdown={() =>
            saveTextFile(formatMarkdown(menu.h, book), `${fileStem(book)}-highlight.md`, "Markdown", "md")
          }
          onExportObsidian={() =>
            saveTextFile(formatObsidian(menu.h, book), `${fileStem(book)}-highlight.md`, "Markdown", "md")
          }
          onDelete={() => removeHighlight(menu.h)}
          onClose={() => setMenu(null)}
        />
      )}

      {undo && (
        <div className={styles.undo} role="status">
          Highlight removed
          <button type="button" className={styles.undoBtn} onClick={restoreHighlight}>
            Undo
          </button>
        </div>
      )}
    </>
  );
}
