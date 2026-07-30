/**
 * The in-app changelog
 */

export type ChangeKind = "new" | "improved" | "fixed";

export interface ChangeNote {
  kind: ChangeKind;
  text: string;
}

export interface Release {
  version: string;
  date: string;
  title?: string;
  notes: ChangeNote[];
}

/** Newest first. Add a new entry at the top each release. */
export const CHANGELOG: Release[] = [
  {
    version: "0.4.1",
    date: "2026-07-30",
    title: "Faster, steadier reading",
    notes: [
      {
        kind: "improved",
        text: "Large and image-heavy EPUBs now open through a leaner reading path, with less work before the first page appears.",
      },
      {
        kind: "fixed",
        text: "Books could finish opening into a blank reader. Their pages, styles, and images now stay in place while they load.",
      },
      {
        kind: "improved",
        text: "Reader layout changes and quick page turns now settle more smoothly.",
      },
      {
        kind: "fixed",
        text: "The Novus window can now be resized from every edge and corner.",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-07-05",
    title: "Highlight and look back",
    notes: [
      { kind: "new", text: "Highlight passages as you read. Pick a color, add a note on why it caught you, and they hold their place as the book reflows." },
      { kind: "new", text: "A highlights panel grouped by chapter, so you can jump straight to any passage. Copy one, save it as an image, or export a book's highlights to Markdown or Obsidian." },
      { kind: "new", text: "Insights: your reading time, pages read, current streak, and pace, with a day-by-day view of the last month." },
      { kind: "new", text: "A Continue Reading shelf that keeps the books you're partway through within reach." },
      { kind: "improved", text: "Shelves now show upright cover cards instead of hard-to-read vertical spines." },
    ],
  },
  {
    version: "0.2.1",
    date: "2026-06-30",
    title: "Reader fixes",
    notes: [
      { kind: "fixed", text: "Page turns could dead-end at the end of a chapter instead of moving on. Fixed." },
      { kind: "fixed", text: "Books could still override your theme, typeface, and font size. They can't anymore." },
      { kind: "new", text: "Visible page-turn buttons on either side of the page." },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-06-29",
    title: "Our own renderer",
    notes: [
      { kind: "improved", text: "Rebuilt the reader on our own rendering engine. Your theme, fonts, and spacing now hold on every book." },
      { kind: "fixed", text: "Some books ignored the reader's styling and showed their own background. Gone." },
      { kind: "new", text: "Reset a book's reading progress from its details." },
      { kind: "new", text: "Chapter count shown in book details." },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-06-26",
    title: "First light",
    notes: [
      { kind: "new", text: "Import EPUBs by drag-and-drop or the file picker into a managed library." },
      { kind: "new", text: "A focused reader that remembers where you left off, with a table of contents." },
      { kind: "new", text: "Collections, reading stats, and a curator rail for your shelf." },
    ],
  },
];

/** Compare two dotted numeric versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}
