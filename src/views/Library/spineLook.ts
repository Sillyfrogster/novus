import type { Book } from "../../lib/types";

export interface SpineLook {
  bg: string;
  fg: string;
}

function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function spineLook(book: Book): SpineLook {
  const h = hash(book.id);
  const hue = 205 + (h % 40);
  const sat = 10 + ((h >> 3) % 12);
  const light = ((h >> 6) % 100) < 22;
  const lum = light ? 80 + ((h >> 9) % 8) : 14 + ((h >> 9) % 12);

  const bg = `hsl(${hue} ${sat}% ${lum}%)`;
  const fg = light ? "rgba(20,24,32,0.92)" : "rgba(238,241,246,0.94)";

  return { bg, fg };
}
