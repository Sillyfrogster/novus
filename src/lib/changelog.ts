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
