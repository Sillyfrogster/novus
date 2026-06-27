import type { Book } from "../../lib/types";

export interface SpineLook {
  width: number;
  height: number;
  bg: string;
  fg: string;
  initials: string;
  light: boolean;
}

/** Stable 32-bit hash of a string (FNV-1a). */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Author initials */
function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter((w) => w[0] && w[0] === w[0].toUpperCase())
    .slice(-2)
    .map((w) => w[0])
    .join("");
}

/**
 * Derive a spine's dimensions and color
 */
export function spineLook(book: Book): SpineLook {
  const h = hash(book.id);
  const sizeMb = book.fileSize / (1024 * 1024);
  const width = Math.round(Math.max(34, Math.min(56, 34 + sizeMb * 6)));
  const height = 196 + (h % 5) * 9;

  const hue = 205 + (h % 40);
  const sat = 10 + ((h >> 3) % 12);
  const light = ((h >> 6) % 100) < 22;
  const lum = light ? 80 + ((h >> 9) % 8) : 14 + ((h >> 9) % 12);

  const bg = `hsl(${hue} ${sat}% ${lum}%)`;
  const fg = light ? "rgba(20,24,32,0.92)" : "rgba(238,241,246,0.94)";

  return { width, height, bg, fg, initials: initialsOf(book.author), light };
}
