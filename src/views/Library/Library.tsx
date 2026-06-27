import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  Check,
  ChevronDown,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { CuratorRail } from "../../components/CuratorRail";
import type { Book } from "../../lib/types";
import { useLibrary } from "../../store/library";
import { DetailModal } from "./DetailModal";
import { EmptyState } from "./EmptyState";
import { HoverPreview } from "./HoverPreview";
import { VirtualShelf } from "./VirtualShelf";
import styles from "./Library.module.css";

/** Cursor must rest on a spine this long before its synopsis surfaces. */
const PEEK_DELAY_MS = 260;

type SortKey = "recent" | "title" | "author";

const SORT_OPTIONS: { value: SortKey; label: string; short: string }[] = [
  { value: "recent", label: "Recently added", short: "Recent" },
  { value: "title", label: "Title (A–Z)", short: "Title" },
  { value: "author", label: "Author (A–Z)", short: "Author" },
];

/** Returns a new array; never mutates the source list. */
function sortBooks(list: Book[], key: SortKey): Book[] {
  const copy = [...list];
  switch (key) {
    case "title":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case "author":
      return copy.sort((a, b) => a.author.localeCompare(b.author));
    default:
      return copy.sort((a, b) => b.addedAt - a.addedAt);
  }
}

interface LibraryProps {
  dropping: boolean;
}

interface MenuState {
  book: Book;
  x: number;
  y: number;
}

interface PeekState {
  book: Book;
  rect: DOMRect;
}

export function Library({ dropping }: LibraryProps) {
  const books = useLibrary((s) => s.books);
  const loading = useLibrary((s) => s.loading);
  const importing = useLibrary((s) => s.importing);
  const storageRoot = useLibrary((s) => s.storageRoot);
  const collections = useLibrary((s) => s.collections);
  const selectedCollectionId = useLibrary((s) => s.selectedCollectionId);
  const pickAndImport = useLibrary((s) => s.pickAndImport);
  const removeBookById = useLibrary((s) => s.removeBookById);
  const openReader = useLibrary((s) => s.openReader);

  const [selected, setSelected] = useState<Book | null>(null);
  const [selectRect, setSelectRect] = useState<DOMRect | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmBook, setConfirmBook] = useState<Book | null>(null);
  const [peek, setPeek] = useState<PeekState | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortMenu, setSortMenu] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const peekTimer = useRef<number | null>(null);

  const openDetail = (book: Book, rect: DOMRect | null) => {
    endPeek();
    setSelectRect(rect);
    setSelected(book);
  };

  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  // search bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clearPeekTimer = () => {
    if (peekTimer.current !== null) {
      window.clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
  };

  const beginPeek = (book: Book, rect: DOMRect) => {
    clearPeekTimer();
    peekTimer.current = window.setTimeout(
      () => setPeek({ book, rect }),
      PEEK_DELAY_MS,
    );
  };

  const endPeek = () => {
    clearPeekTimer();
    setPeek(null);
  };

  useEffect(() => clearPeekTimer, []);

  const activeCollection =
    selectedCollectionId === null
      ? null
      : (collections.find((c) => c.id === selectedCollectionId) ?? null);
  const shelfLabel = activeCollection?.name ?? "All Books";
  const q = query.trim().toLowerCase();
  const shownBooks = useMemo(() => {
    const memberIds = activeCollection
      ? new Set(activeCollection.bookIds)
      : null;
    const collectionBooks = memberIds
      ? books.filter((b) => memberIds.has(b.id))
      : books;
    const filtered = q
      ? collectionBooks.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.author.toLowerCase().includes(q),
        )
      : collectionBooks;
    return sortBooks(filtered, sort);
  }, [books, activeCollection, q, sort]);

  const read = (book: Book, locator?: string) => {
    setSelected(null);
    setMenu(null);
    openReader(book.id, locator);
  };

  // Removal deletes the managed file with no undo, so it always confirms first.
  const remove = (book: Book) => {
    endPeek();
    setMenu(null);
    setConfirmBook(book);
  };

  const performRemove = () => {
    if (!confirmBook) return;
    setSelected(null);
    setConfirmBook(null);
    removeBookById(confirmBook.id);
  };

  return (
    <div className={styles.content}>
      {loading ? null : books.length === 0 ? (
        <EmptyState onAddBooks={pickAndImport} busy={importing} />
      ) : (
        <div className={styles.layout}>
          <CuratorRail
            books={books}
            storageRoot={storageRoot}
            onOpen={(b) => openDetail(b, null)}
            onRead={read}
          />
          <div className={styles.shelves} data-scroller>
            <div className={styles.shelvesInner}>
              <div className={styles.masthead}>
                <div>
                  <div className={styles.mastEyebrow}>Your collection</div>
                  <h1 className={styles.mastTitle}>Library</h1>
                </div>
                <div className={styles.mastControls}>
                  <div className={styles.sortWrap}>
                    <button
                      type="button"
                      className={styles.sortBtn}
                      aria-haspopup="menu"
                      aria-expanded={sortMenu}
                      onClick={() => setSortMenu((v) => !v)}
                    >
                      {SORT_OPTIONS.find((o) => o.value === sort)?.short}
                      <ChevronDown size={11} strokeWidth={2.2} />
                    </button>
                    {sortMenu && (
                      <>
                        <div
                          className={styles.menuScrim}
                          onClick={() => setSortMenu(false)}
                        />
                        <div className={styles.sortMenu} role="menu">
                          {SORT_OPTIONS.map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              role="menuitemradio"
                              aria-checked={sort === o.value}
                              className={`${styles.sortItem} ${sort === o.value ? styles.sortItemOn : ""}`}
                              onClick={() => {
                                setSort(o.value);
                                setSortMenu(false);
                              }}
                            >
                              {o.label}
                              {sort === o.value && (
                                <Check size={14} strokeWidth={2} />
                              )}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {searchOpen ? (
                    <div className={styles.searchInline}>
                      <Search size={15} strokeWidth={2} />
                      <input
                        ref={searchRef}
                        type="search"
                        className={styles.searchInlineInput}
                        placeholder="Search title or author"
                        aria-label="Search your library"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") closeSearch();
                        }}
                      />
                      <button
                        type="button"
                        className={styles.searchClose}
                        title="Close search"
                        aria-label="Close search"
                        onClick={closeSearch}
                      >
                        <X size={13} strokeWidth={2} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Search your library (⌘F)"
                      aria-label="Search your library"
                      onClick={openSearch}
                    >
                      <Search size={17} strokeWidth={2} />
                    </button>
                  )}

                  <button
                    type="button"
                    className={styles.addBtn}
                    onClick={pickAndImport}
                    disabled={importing}
                  >
                    <Plus size={14} strokeWidth={1.8} />
                    {importing ? "Importing…" : "Add books"}
                  </button>
                </div>
              </div>

              <div className={styles.shelf}>
                <div className={styles.shelfHead}>
                  <span className={styles.shelfLabel}>{shelfLabel}</span>
                  <span className={styles.shelfRule} />
                  <span className={styles.shelfCount}>
                    {shownBooks.length}{" "}
                    {shownBooks.length === 1 ? "VOLUME" : "VOLUMES"}
                  </span>
                </div>
                {shownBooks.length === 0 ? (
                  <div className={styles.collEmpty}>
                    {q
                      ? `No books match “${query.trim()}”.`
                      : "Nothing here yet — add books from their details or right-click menu."}
                  </div>
                ) : (
                  <VirtualShelf
                    books={shownBooks}
                    onOpen={(b, rect) => openDetail(b, rect)}
                    onMenu={(b, x, y) => {
                      endPeek();
                      setMenu({ book: b, x, y });
                    }}
                    onPeek={beginPeek}
                    onPeekEnd={endPeek}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {dropping && (
        <div className={styles.dropping}>Drop to add to your library</div>
      )}

      {peek && !menu && !selected && (
        <HoverPreview
          book={peek.book}
          storageRoot={storageRoot}
          rect={peek.rect}
        />
      )}

      {menu && (
        <>
          <div
            className={styles.menuScrim}
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className={styles.menu}
            style={{
              left: Math.min(menu.x, window.innerWidth - 220),
              top: Math.min(menu.y, window.innerHeight - 120),
            }}
          >
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => read(menu.book)}
            >
              <Play size={14} fill="currentColor" strokeWidth={0} />
              {menu.book.progress > 0 && menu.book.progress < 1
                ? "Continue reading"
                : "Read"}
            </button>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                openDetail(menu.book, null);
                setMenu(null);
              }}
            >
              <AlignLeft size={14} strokeWidth={1.7} />
              Details
            </button>
            <div className={styles.menuDivider} />
            <button
              type="button"
              className={`${styles.menuItem} ${styles.danger}`}
              onClick={() => remove(menu.book)}
            >
              <Trash2 size={14} strokeWidth={1.7} />
              Remove from library
            </button>
          </div>
        </>
      )}

      {selected && (
        <DetailModal
          book={selected}
          storageRoot={storageRoot}
          originRect={selectRect}
          onClose={() => {
            setSelected(null);
            setSelectRect(null);
          }}
          onRead={read}
          onRemove={remove}
        />
      )}

      {confirmBook && (
        <ConfirmDialog
          title="Remove from library?"
          body={`“${confirmBook.title}” and its file will be deleted from your library. This can’t be undone.`}
          confirmLabel="Remove"
          onConfirm={performRemove}
          onCancel={() => setConfirmBook(null)}
        />
      )}
    </div>
  );
}
