import { coverUrl } from "../../lib/assets";
import type { Book } from "../../lib/types";
import { spineLook } from "./spine";
import styles from "./Library.module.css";

const PREVIEW_WIDTH = 288;
const GAP = 16;
const FLIP_THRESHOLD = 220;

interface HoverPreviewProps {
  book: Book;
  storageRoot: string;
  rect: DOMRect;
}

function statusLabel(progress: number): string {
  if (progress >= 1) return "Finished";
  if (progress > 0) return `${Math.round(progress * 100)}% read`;
  return "Not started";
}

function metaLine(book: Book): string {
  const parts = [book.format.toUpperCase()];
  if (book.pageCount) parts.push(`${book.pageCount} pages`);
  parts.push(`${(book.fileSize / (1024 * 1024)).toFixed(1)} MB`);
  return parts.join(" · ");
}

export function HoverPreview({ book, storageRoot, rect }: HoverPreviewProps) {
  const cover = coverUrl(book, storageRoot);
  const look = spineLook(book);

  const centre = rect.left + rect.width / 2;
  const left = Math.max(
    GAP,
    Math.min(centre - PREVIEW_WIDTH / 2, window.innerWidth - PREVIEW_WIDTH - GAP),
  );
  const flipBelow = rect.top < FLIP_THRESHOLD;
  const position = flipBelow
    ? { top: rect.bottom + GAP }
    : { top: rect.top - GAP, transform: "translateY(-100%)" };

  return (
    <div
      className={styles.preview}
      style={{ left, width: PREVIEW_WIDTH, ...position }}
      role="presentation"
    >
      <div className={styles.previewHead}>
        <div
          className={styles.previewCover}
          style={
            cover
              ? { backgroundImage: `url(${cover})`, color: "transparent" }
              : { background: look.bg, color: look.fg }
          }
        >
          {!cover && (
            <>
              <span className={styles.previewCoverTag}>{book.format.toUpperCase()}</span>
              <span className={styles.previewCoverTitle}>{book.title}</span>
            </>
          )}
        </div>
        <div className={styles.previewMeta}>
          <div className={styles.previewTitle}>{book.title}</div>
          <div className={styles.previewAuthor}>{book.author}</div>
          <div className={styles.previewMetaLine}>{metaLine(book)}</div>
        </div>
      </div>

      {book.description ? (
        <p className={styles.previewSynopsis}>{book.description}</p>
      ) : (
        <p className={`${styles.previewSynopsis} ${styles.previewSynopsisEmpty}`}>
          No synopsis available.
        </p>
      )}

      <div className={styles.previewFoot}>
        <span>{statusLabel(book.progress)}</span>
        <span>CLICK TO OPEN</span>
      </div>
    </div>
  );
}
