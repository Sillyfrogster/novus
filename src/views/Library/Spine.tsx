import { useState } from "react";

import { coverUrl } from "../../lib/assets";
import type { Book } from "../../lib/types";
import { spineLook } from "./spineLook";
import styles from "./Library.module.css";

export const CARD_W = 120;
export const CARD_H = 180;

const loadedCovers = new Set<string>();

interface CoverState {
  url: string | null;
  ready: boolean;
  failed: boolean;
}

interface SpineProps {
  book: Book;
  storageRoot: string;
  onOpen: (book: Book, rect: DOMRect) => void;
  onMenu: (book: Book, x: number, y: number) => void;
  onPeek: (book: Book, rect: DOMRect) => void;
  onPeekEnd: () => void;
  progressEdge?: boolean;
}

/** A single book rendered as a shelved, forward-facing cover card. */
export function Spine({
  book,
  storageRoot,
  onOpen,
  onMenu,
  onPeek,
  onPeekEnd,
  progressEdge = false,
}: SpineProps) {
  const cover = coverUrl(book, storageRoot);
  const [coverState, setCoverState] = useState<CoverState>(() => ({
    url: cover,
    ready: !cover || loadedCovers.has(cover),
    failed: false,
  }));
  const look = spineLook(book);
  const inProgress = book.progress > 0 && book.progress < 1;
  const currentCover =
    coverState.url === cover
      ? coverState
      : { url: cover, ready: !cover || loadedCovers.has(cover), failed: false };
  const showCover = Boolean(cover && !currentCover.failed);

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
      {inProgress && !progressEdge && <span className={styles.ribbon} />}
      <div
        className={styles.cardCover}
        data-cover-ready={currentCover.ready}
        style={showCover ? undefined : { background: look.bg, color: look.fg }}
      >
        {showCover && (
          <>
            <span className={styles.cardCoverSkeleton} aria-hidden="true" />
            <img
              className={styles.cardCoverImage}
              src={cover ?? undefined}
              alt=""
              decoding="async"
              draggable={false}
              onLoad={() => {
                if (cover) loadedCovers.add(cover);
                setCoverState({ url: cover, ready: true, failed: false });
              }}
              onError={() => {
                setCoverState({ url: cover, ready: true, failed: true });
              }}
            />
          </>
        )}
        {!showCover && (
          <div className={styles.cardFallback}>
            <span className={styles.cardTag}>{book.format.toUpperCase()}</span>
            <span className={styles.cardTitle}>{book.title}</span>
            <span className={styles.cardAuthor}>{book.author}</span>
          </div>
        )}
      </div>
      {progressEdge && (
        <span className={styles.cardProgress} aria-hidden="true">
          <span
            className={styles.cardProgressFill}
            style={{ width: `${Math.round(book.progress * 100)}%` }}
          />
        </span>
      )}
    </button>
  );
}
