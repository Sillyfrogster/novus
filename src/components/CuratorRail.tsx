import { useMemo, useState } from "react";
import { BarChart3, Plus, Search, X } from "lucide-react";

import { coverUrl } from "../lib/assets";
import type { Book, Collection } from "../lib/types";
import { useLibrary } from "../store/library";
import { ConfirmDialog } from "./ConfirmDialog";
import { Mark } from "./Mark";
import styles from "./CuratorRail.module.css";

interface CuratorRailProps {
  books: Book[];
  storageRoot: string;
  onRead: (book: Book) => void;
  onSearch: () => void;
}

/** The most recently read in-progress book, if any. */
function recentBook(books: Book[]): Book | null {
  const inProgress = books.filter((b) => b.progress > 0 && b.progress < 1);
  if (inProgress.length === 0) return null;
  return inProgress.reduce((latest, b) =>
    (b.lastReadAt ?? b.addedAt) > (latest.lastReadAt ?? latest.addedAt) ? b : latest,
  );
}

export function CuratorRail({ books, storageRoot, onRead, onSearch }: CuratorRailProps) {
  const collections = useLibrary((s) => s.collections);
  const selectedCollectionId = useLibrary((s) => s.selectedCollectionId);
  const profileName = useLibrary((s) => s.profileName);
  const selectCollection = useLibrary((s) => s.selectCollection);
  const openInsights = useLibrary((s) => s.openInsights);
  const addCollection = useLibrary((s) => s.addCollection);
  const removeCollection = useLibrary((s) => s.removeCollection);
  const setProfileName = useLibrary((s) => s.setProfileName);

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(profileName);
  const [confirmColl, setConfirmColl] = useState<Collection | null>(null);

  const recent = useMemo(() => recentBook(books), [books]);

  if (books.length === 0) return null;

  const submitNew = () => {
    if (newName.trim()) addCollection(newName);
    setNewName("");
    setNewOpen(false);
  };

  const commitName = () => {
    setProfileName(nameDraft);
    setEditingName(false);
  };

  return (
    <>
    <aside className={styles.rail}>
      {recent && (
        <div className={styles.section}>
          <div className={styles.label}>Continue</div>
          <button
            type="button"
            className={styles.recentBtn}
            title={`Continue reading ${recent.title}`}
            onClick={() => onRead(recent)}
          >
            <div
              className={styles.recentCover}
              style={
                coverUrl(recent, storageRoot)
                  ? { backgroundImage: `url(${coverUrl(recent, storageRoot)})` }
                  : undefined
              }
            />
            <div className={styles.recentMeta}>
              <div className={styles.recentTitle}>{recent.title}</div>
              <div className={styles.recentPct}>
                {Math.round(recent.progress * 100)}% READ
              </div>
            </div>
          </button>
        </div>
      )}

      <div className={styles.collections}>
        <div className={styles.collHead}>
          <span className={styles.collLabel}>Collections</span>
          <div className={styles.collTools}>
            <button
              type="button"
              className={styles.newBtn}
              title="Search your library (⌘F)"
              onClick={onSearch}
            >
              <Search size={12} strokeWidth={2} />
            </button>
            <button
              type="button"
              className={styles.newBtn}
              title="New collection"
              onClick={() => setNewOpen((v) => !v)}
            >
              <Plus size={13} strokeWidth={2} />
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`${styles.collItem} ${selectedCollectionId === null ? styles.collActive : ""}`}
          onClick={() => selectCollection(null)}
        >
          <span className={styles.collDot} />
          <span className={styles.collName}>All Books</span>
          <span className={styles.collCount}>{books.length}</span>
        </button>

        {collections.map((c) => (
          <div key={c.id} className={styles.collRow}>
            <button
              type="button"
              className={`${styles.collItem} ${selectedCollectionId === c.id ? styles.collActive : ""}`}
              onClick={() => selectCollection(c.id)}
            >
              <span className={styles.collDot} />
              <span className={styles.collName}>{c.name}</span>
              <span className={styles.collCount}>{c.bookIds.length}</span>
            </button>
            <button
              type="button"
              className={styles.collDelete}
              title="Delete collection"
              onClick={() => setConfirmColl(c)}
            >
              <X size={12} strokeWidth={1.4} />
            </button>
          </div>
        ))}

        {newOpen && (
          <label className={styles.newField}>
            <span className={styles.newLabel}>New collection</span>
            <input
              autoFocus
              className={styles.newInput}
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNew();
                else if (e.key === "Escape") setNewOpen(false);
              }}
              onBlur={submitNew}
            />
          </label>
        )}

        <button
          type="button"
          className={styles.collItem}
          onClick={() => void openInsights()}
        >
          <BarChart3 size={13} strokeWidth={2} className={styles.collGlyph} />
          <span className={styles.collName}>Insights</span>
        </button>
      </div>

      <div className={styles.footer}>
        <div className={styles.avatar}>
          <Mark size={17} />
        </div>
        <div className={styles.footerMeta}>
          {editingName ? (
            <input
              autoFocus
              className={styles.nameInput}
              aria-label="Profile name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                else if (e.key === "Escape") setEditingName(false);
              }}
              onBlur={commitName}
            />
          ) : (
            <button
              type="button"
              className={styles.footerName}
              title="Rename"
              onClick={() => {
                setNameDraft(profileName);
                setEditingName(true);
              }}
            >
              {profileName}
            </button>
          )}
          <div className={styles.footerCount}>
            {books.length} {books.length === 1 ? "VOLUME" : "VOLUMES"}
          </div>
        </div>
        <button type="button" className={styles.signIn} title="Account sync — coming soon">
          Sign in
        </button>
      </div>
    </aside>

    {confirmColl && (
      <ConfirmDialog
        title="Delete collection?"
        body={`“${confirmColl.name}” will be deleted. Your books stay in your library.`}
        confirmLabel="Delete"
        onConfirm={() => {
          removeCollection(confirmColl.id);
          setConfirmColl(null);
        }}
        onCancel={() => setConfirmColl(null)}
      />
    )}
    </>
  );
}
