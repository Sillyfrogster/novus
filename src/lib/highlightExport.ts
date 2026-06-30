import { save } from "@tauri-apps/plugin-dialog";

import { writeFile } from "./ipc";
import type { Book, Highlight } from "./types";

function locationLabel(h: Highlight): string | null {
  return h.location != null ? `location ${h.location + 1}` : null;
}

function attribution(h: Highlight, book: Book): string {
  const parts = [book.author, h.chapterLabel?.trim(), locationLabel(h)].filter(Boolean);
  return parts.join(", ");
}

export function formatPlain(h: Highlight, book: Book): string {
  let out = `"${h.text}"\n\n— ${book.title}${attribution(h, book) ? `, ${attribution(h, book)}` : ""}`;
  if (h.note) out += `\n\nNote: ${h.note}`;
  return out + "\n";
}

export function formatMarkdown(h: Highlight, book: Book): string {
  const quoted = h.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const meta = [h.chapterLabel?.trim(), locationLabel(h)].filter(Boolean).join(" · ");
  let out = `${quoted}\n>\n> — *${book.title}*, ${book.author}`;
  if (meta) out += ` (${meta})`;
  if (h.note) out += `\n\n${h.note}`;
  return out + "\n";
}

export function formatObsidian(h: Highlight, book: Book): string {
  const body = h.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const meta = [h.chapterLabel?.trim(), locationLabel(h)].filter(Boolean).join(" · ");
  let out = `> [!quote] ${book.title} — ${book.author}\n${body}`;
  if (meta) out += `\n>\n> ${meta}`;
  if (h.note) out += `\n\n${h.note}`;
  return out + "\n";
}

export function fileStem(book: Book): string {
  return (
    book.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "highlight"
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function saveTextFile(
  content: string,
  defaultName: string,
  filterName: string,
  ext: string,
): Promise<boolean> {
  const path = await save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
  if (!path) return false;
  await writeFile(path, new TextEncoder().encode(content));
  return true;
}

export async function saveImageFile(blob: Blob, defaultName: string): Promise<boolean> {
  const path = await save({ defaultPath: defaultName, filters: [{ name: "PNG image", extensions: ["png"] }] });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}
