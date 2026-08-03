import { Check, Play, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { bookToc } from "../../lib/ipc";
import type { Book } from "../../lib/types";
import type { TocItem } from "../../reader/types";
import { useLibrary } from "../../store/library";
import styles from "./DetailModal.module.css";

const TOC_COLLAPSED = 8;

interface FlatTocItem {
  label: string;
  href: string;
  depth: number;
}

function flattenContents(items: readonly TocItem[], depth = 0): FlatTocItem[] {
  return items.flatMap((item) => [
    { label: item.label, href: item.href, depth },
    ...flattenContents(item.subitems ?? [], depth + 1),
  ]);
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

interface DetailOverviewProps {
  book: Book;
  onRead: (book: Book, locator?: string) => void;
  onRemove: (book: Book) => void;
}

export function DetailOverview({ book, onRead, onRemove }: DetailOverviewProps) {
  const collections = useLibrary((state) => state.collections);
  const toggleMembership = useLibrary((state) => state.toggleMembership);
  const addCollection = useLibrary((state) => state.addCollection);
  const resetProgress = useLibrary((state) => state.resetProgress);
  const [progress, setProgress] = useState(() => book.progress);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [toc, setToc] = useState<FlatTocItem[] | null>(null);
  const [tocExpanded, setTocExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    void bookToc(book.id)
      .then((entries) => {
        if (active) setToc(flattenContents(entries));
      })
      .catch(() => {
        if (active) setToc([]);
      });
    return () => {
      active = false;
    };
  }, [book.id]);

  const submitNew = () => {
    if (newName.trim()) void addCollection(newName);
    setNewName("");
    setNewOpen(false);
  };

  return (
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
              {(tocExpanded ? toc : toc.slice(0, TOC_COLLAPSED)).map((entry, index) => (
                <li key={`${entry.href}-${entry.depth}-${entry.label}`}>
                  <button
                    type="button"
                    className={styles.tocItem}
                    style={{ paddingLeft: 10 + entry.depth * 16 }}
                    onClick={() => onRead(book, entry.href)}
                    disabled={!entry.href}
                  >
                    <span className={styles.tocNum}>
                      {String(index + 1).padStart(2, "0")}
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
                onClick={() => setTocExpanded((expanded) => !expanded)}
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
          <button
            type="button"
            className={styles.collNew}
            onClick={() => setNewOpen((open) => !open)}
          >
            + New
          </button>
        </div>
        <div className={styles.chips}>
          {collections.length === 0 && !newOpen && (
            <span className={styles.chipsEmpty}>No collections yet.</span>
          )}
          {collections.map((collection) => {
            const member = collection.bookIds.includes(book.id);
            return (
              <button
                key={collection.id}
                type="button"
                className={`${styles.chip} ${member ? styles.chipOn : ""}`}
                onClick={() => void toggleMembership(collection.id, book.id, !member)}
              >
                {member && <Check size={11} strokeWidth={2.4} />}
                {collection.name}
              </button>
            );
          })}
        </div>
        {newOpen && (
          <label className={styles.chipField}>
            <span className={styles.chipLabel}>New collection</span>
            <input
              autoFocus
              className={styles.chipInput}
              placeholder="Name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitNew();
                else if (event.key === "Escape") setNewOpen(false);
              }}
              onBlur={submitNew}
            />
          </label>
        )}
      </div>
    </>
  );
}
