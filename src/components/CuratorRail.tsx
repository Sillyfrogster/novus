import { useMemo, useState } from "react";
import { Play, Plus, X } from "lucide-react";

import { coverUrl } from "../lib/assets";
import type { Book, Collection, WeekStats } from "../lib/types";
import { useLibrary } from "../store/library";
import { ConfirmDialog } from "./ConfirmDialog";
import { Mark } from "./Mark";
import styles from "./CuratorRail.module.css";

interface CuratorRailProps {
  books: Book[];
  storageRoot: string;
  onOpen: (book: Book) => void;
  onRead: (book: Book) => void;
}

function focusBook(books: Book[]): Book {
  const inProgress = books.filter((b) => b.progress > 0 && b.progress < 1);
  return inProgress[0] ?? books[0];
}

function hoursLabel(seconds: number): string {
  if (seconds < 60) return "0h";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

interface ShelfInsights {
  finished: number;
  reading: number;
  unread: number;
  total: number;
  topAuthor: { name: string; count: number } | null;
}

/** Derive the rail's insights */
function deriveInsights(books: Book[]): ShelfInsights {
  let finished = 0;
  let reading = 0;
  const byAuthor = new Map<string, number>();
  for (const b of books) {
    if (b.progress >= 1) finished++;
    else if (b.progress > 0) reading++;
    byAuthor.set(b.author, (byAuthor.get(b.author) ?? 0) + 1);
  }
  let topAuthor: { name: string; count: number } | null = null;
  for (const [name, count] of byAuthor) {
    if (!topAuthor || count > topAuthor.count) topAuthor = { name, count };
  }
  if (topAuthor && topAuthor.count < 2) topAuthor = null;
  return { finished, reading, unread: books.length - finished - reading, total: books.length, topAuthor };
}

/** Average daily pages across the trailing week, or null if nothing was read. */
function paceLabel(stats: WeekStats | null): string | null {
  if (!stats || stats.pages <= 0) return null;
  const perDay = Math.max(1, Math.round(stats.pages / 7));
  return `≈ ${perDay} ${perDay === 1 ? "page" : "pages"} a day this week`;
}

function pctOf(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/**
 * The left rail (sidebar)
 */
export function CuratorRail({ books, storageRoot, onOpen, onRead }: CuratorRailProps) {
  const collections = useLibrary((s) => s.collections);
  const selectedCollectionId = useLibrary((s) => s.selectedCollectionId);
  const stats = useLibrary((s) => s.stats);
  const profileName = useLibrary((s) => s.profileName);
  const selectCollection = useLibrary((s) => s.selectCollection);
  const addCollection = useLibrary((s) => s.addCollection);
  const removeCollection = useLibrary((s) => s.removeCollection);
  const setProfileName = useLibrary((s) => s.setProfileName);

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(profileName);
  const [confirmColl, setConfirmColl] = useState<Collection | null>(null);

  const insights = useMemo(() => deriveInsights(books), [books]);
  const pace = paceLabel(stats);

  if (books.length === 0) return null;

  const focus = focusBook(books);
  const inProgress = focus.progress > 0 && focus.progress < 1;
  const cover = coverUrl(focus, storageRoot);
  const pct = Math.round(focus.progress * 100);

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
      <div className={styles.section}>
        <div className={styles.label}>{inProgress ? "Now Reading" : "Start Here"}</div>
        <button type="button" className={styles.nowBtn} onClick={() => onOpen(focus)}>
          <div
            className={styles.nowCover}
            style={cover ? { backgroundImage: `url(${cover})` } : { background: "var(--surface-2)" }}
          >
            {!cover && focus.title}
          </div>
          <div className={styles.nowMeta}>
            <div className={styles.nowTitle}>{focus.title}</div>
            <div className={styles.nowAuthor}>{focus.author}</div>
            {inProgress && (
              <div className={styles.nowProgress}>
                <div className={styles.track}>
                  <div className={styles.fill} style={{ width: `${pct}%` }} />
                </div>
                <span className={styles.pct}>{pct}%</span>
              </div>
            )}
          </div>
        </button>
        <button type="button" className={styles.cta} onClick={() => onRead(focus)}>
          <Play size={13} fill="currentColor" strokeWidth={0} />
          {inProgress ? "Continue reading" : "Start reading"}
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.label}>This Week</div>
        <div className={styles.week}>
          <div className={styles.stat}>
            <div className={styles.statNum}>{stats?.streakDays ?? 0}</div>
            <div className={styles.statLbl}>day streak</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statNum}>{hoursLabel(stats?.seconds ?? 0)}</div>
            <div className={styles.statLbl}>read</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statNum}>{stats?.pages ?? 0}</div>
            <div className={styles.statLbl}>pages</div>
          </div>
        </div>
      </div>

      <div className={`${styles.section} ${styles.shelfSection}`}>
        <div className={styles.label}>Your Shelf</div>
        <div
          className={styles.shelfBar}
          role="img"
          aria-label={`${insights.finished} finished, ${insights.reading} reading, ${insights.unread} unread`}
        >
          <span
            className={styles.segFinished}
            style={{ width: `${pctOf(insights.finished, insights.total)}%` }}
          />
          <span
            className={styles.segReading}
            style={{ width: `${pctOf(insights.reading, insights.total)}%` }}
          />
        </div>
        <div className={styles.shelfCaption}>
          {insights.finished} finished · {insights.reading} reading · {insights.unread} to go
        </div>
        {insights.topAuthor && (
          <div className={styles.insight}>
            Most shelved — <strong>{insights.topAuthor.name}</strong> · {insights.topAuthor.count}{" "}
            volumes
          </div>
        )}
        {pace && <div className={styles.insight}>{pace}</div>}
      </div>

      <div className={styles.collections}>
        <div className={styles.collHead}>
          <span className={styles.collLabel}>Collections</span>
          <button
            type="button"
            className={styles.newBtn}
            title="New collection"
            onClick={() => setNewOpen((v) => !v)}
          >
            <Plus size={13} strokeWidth={2} />
          </button>
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
          <input
            autoFocus
            className={styles.newInput}
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

      <div className={styles.footer}>
        <div className={styles.avatar}>
          <Mark size={17} />
        </div>
        <div className={styles.footerMeta}>
          {editingName ? (
            <input
              autoFocus
              className={styles.nameInput}
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
