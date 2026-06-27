import type { Book } from "../../lib/types";
import { spineLook } from "./spine";
import styles from "./Library.module.css";

interface SpineProps {
  book: Book;
  onOpen: (book: Book, rect: DOMRect) => void;
  onMenu: (book: Book, x: number, y: number) => void;
  onPeek: (book: Book, rect: DOMRect) => void;
  onPeekEnd: () => void;
}

/** A single book rendered as a shelved spine. */
export function Spine({ book, onOpen, onMenu, onPeek, onPeekEnd }: SpineProps) {
  const look = spineLook(book);
  const inProgress = book.progress > 0 && book.progress < 1;
  const titleSize = book.title.length > 26 ? 12.5 : 14;

  return (
    <button
      type="button"
      className={styles.spine}
      style={{
        width: look.width,
        height: look.height,
        background: `linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0) 22%, rgba(0,0,0,0.16) 100%), ${look.bg}`,
        color: look.fg,
      }}
      onClick={(e) => onOpen(book, e.currentTarget.getBoundingClientRect())}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(book, e.clientX, e.clientY);
      }}
      onMouseEnter={(e) => onPeek(book, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onPeekEnd}
      title={`${book.title} — ${book.author}`}
    >
      {inProgress && <span className={styles.ribbon} />}
      <span
        className={styles.spineTitle}
        style={{ fontSize: titleSize, maxHeight: look.height - 58, color: look.fg }}
      >
        {book.title}
      </span>
      <span
        className={styles.spineFoot}
        style={{ color: look.light ? "rgba(20,24,32,0.5)" : "rgba(238,241,246,0.5)" }}
      >
        {look.initials}
      </span>
    </button>
  );
}
