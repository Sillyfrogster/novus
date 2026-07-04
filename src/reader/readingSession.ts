import type { SessionRecord } from "../lib/ipc";
import type { RelocateReason } from "./types";

export const GAP_CAP_MS = 180_000;
export const MIN_READ_DWELL_MS = 3000;
const MIN_SESSION_MS = 3000;

interface SessionEvent {
  tMs: number;
  fraction: number;
  reason: RelocateReason;
}

export class ReadingSession {
  readonly uuid: string = crypto.randomUUID();
  readonly #startedAtMs: number = Date.now();
  readonly #startFraction: number;
  #events: SessionEvent[] = [];

  constructor(startFraction: number) {
    this.#startFraction = startFraction;
  }

  add(fraction: number, reason: RelocateReason): void {
    if (reason === "layout") return;
    this.#events.push({ tMs: Date.now(), fraction, reason });
  }

  toRecord(bookId: string): SessionRecord | null {
    const nowMs = Date.now();
    if (nowMs - this.#startedAtMs < MIN_SESSION_MS) return null;

    let activeMs = 0;
    let lastT = this.#startedAtMs;
    let lastFraction = this.#startFraction;
    const readDwells: number[] = [];

    for (const event of this.#events) {
      const dwellMs = Math.min(event.tMs - lastT, GAP_CAP_MS);
      activeMs += dwellMs;
      const isReadingMotion = event.reason === "page" || event.reason === "scroll";
      if (isReadingMotion && event.fraction > lastFraction && dwellMs >= MIN_READ_DWELL_MS) {
        readDwells.push(dwellMs);
      }
      lastT = event.tMs;
      lastFraction = event.fraction;
    }
    activeMs += Math.min(nowMs - lastT, GAP_CAP_MS);

    return {
      uuid: this.uuid,
      bookId,
      startedAt: Math.floor(this.#startedAtMs / 1000),
      endedAt: Math.floor(nowMs / 1000),
      activeSeconds: Math.round(activeMs / 1000),
      pagesRead: readDwells.length,
      medianPageMs: median(readDwells),
      startFraction: this.#startFraction,
      endFraction: lastFraction,
    };
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
