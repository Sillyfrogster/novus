import { coverUrl } from "../../lib/assets";
import type { Book } from "../../lib/types";
import { spineLook } from "./spineLook";
import styles from "./Library.module.css";

export const CARD_W = 120;
export const CARD_H = 180;

interface SpineProps {
  book: Book;
  storageRoot: string;
  onOpen: (book: Book, rect: DOMRect) => void;
  onMenu: (book: Book, x: number, y: number) => void;
  onPeek: (book: Book, rect: DOMRect) => void;
  onPeekEnd: () => void;
}

/** A single book rendered as a shelved, forward-facing cover card. */
export function Spine({ book, storageRoot, onOpen, onMenu, onPeek, onPeekEnd }: SpineProps) {
  const cover = coverUrl(book, storageRoot);
  const look = spineLook(book);
  const inProgress = book.progress > 0 && book.progress < 1;

  return (
    <button
      type="button"
      className={styles.card}
      style={{ width: CARD_W, height: CARD_H }}
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
      <div
        className={styles.cardCover}
        style={
          cover
            ? { backgroundImage: `url(${cover})`, color: "transparent" }
            : { background: look.bg, color: look.fg }
        }
      >
        {!cover && (
          <div className={styles.cardFallback}>
            <span className={styles.cardTag}>{book.format.toUpperCase()}</span>
            <span className={styles.cardTitle}>{book.title}</span>
            <span className={styles.cardAuthor}>{book.author}</span>
          </div>
        )}
      </div>
    </button>
  );
}
