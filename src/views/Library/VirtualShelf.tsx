import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Book } from "../../lib/types";
import { spineLook } from "./spineLook";
import { Spine } from "./Spine";
import styles from "./Library.module.css";

const GAP = 11;
const SIDE_PAD = 2;
const SPINE_MAX_H = 232;
const LIFT_CLEARANCE = 22;
const LEDGE_H = 7;
const LEDGE_UNDER_H = 20;
const ROW_GAP = 30;
const ROW_HEIGHT = LIFT_CLEARANCE + SPINE_MAX_H + LEDGE_H + LEDGE_UNDER_H + ROW_GAP;
const OVERSCAN_ROWS = 2;

interface VirtualShelfProps {
  books: Book[];
  onOpen: (book: Book, rect: DOMRect) => void;
  onMenu: (book: Book, x: number, y: number) => void;
  onPeek: (book: Book, rect: DOMRect) => void;
  onPeekEnd: () => void;
}

/** Greedily pack books left-to-right, wrapping to a new shelf when the row is full. */
function packRows(books: Book[], avail: number): Book[][] {
  if (avail <= 0) return [];
  const rows: Book[][] = [];
  let row: Book[] = [];
  let used = 0;
  for (const book of books) {
    const w = spineLook(book).width;
    const needed = row.length === 0 ? w : GAP + w;
    if (row.length > 0 && used + needed > avail) {
      rows.push(row);
      row = [];
      used = 0;
    }
    used += row.length === 0 ? w : GAP + w;
    row.push(book);
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/**
 * Virtual Shelf wall.
 **/
export function VirtualShelf({
  books,
  onOpen,
  onMenu,
  onPeek,
  onPeekEnd,
}: VirtualShelfProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState({ topHidden: 0, height: 0 });
  const rows = useMemo(() => packRows(books, width - SIDE_PAD * 2), [books, width]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const scroller = stage?.closest<HTMLElement>("[data-scroller]");
    if (!stage || !scroller) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      setWidth(stage.clientWidth);
      const s = scroller.getBoundingClientRect();
      const t = stage.getBoundingClientRect();
      setView({ topHidden: s.top - t.top, height: s.height });
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(stage);
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      ro.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const first = Math.max(0, Math.floor(view.topHidden / ROW_HEIGHT) - OVERSCAN_ROWS);
  const last = Math.min(
    rows.length,
    Math.ceil((view.topHidden + view.height) / ROW_HEIGHT) + OVERSCAN_ROWS,
  );
  const visible = rows.slice(first, last);

  return (
    <div ref={stageRef} className={styles.vstage} style={{ height: rows.length * ROW_HEIGHT }}>
      {visible.map((row, i) => {
        const rowIndex = first + i;
        return (
          <div
            key={rowIndex}
            className={styles.vrow}
            style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT - ROW_GAP }}
          >
            <div
              className={styles.vline}
              style={{ height: LIFT_CLEARANCE + SPINE_MAX_H, paddingTop: LIFT_CLEARANCE }}
            >
              {row.map((book) => (
                <Spine
                  key={book.id}
                  book={book}
                  onOpen={onOpen}
                  onMenu={onMenu}
                  onPeek={onPeek}
                  onPeekEnd={onPeekEnd}
                />
              ))}
            </div>
            <div className={styles.ledge} />
            <div className={styles.ledgeUnder} />
          </div>
        );
      })}
    </div>
  );
}
