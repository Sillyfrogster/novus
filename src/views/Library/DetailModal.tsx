import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Play, RotateCcw, Trash2, X } from "lucide-react";

import { coverUrl } from "../../lib/assets";
import { bookToc } from "../../lib/ipc";
import type { Book, TocEntry } from "../../lib/types";
import { useLibrary } from "../../store/library";
import { spineLook } from "./spineLook";
import styles from "./DetailModal.module.css";

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
  const modalW = Math.min(740, window.innerWidth - 120);
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
        </div>
      </div>
    </>
  );
}
