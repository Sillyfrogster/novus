/**
 * Open an EPUB file into the parsed book model.
 */
import type { ZipEntry } from "../../vendor/foliate-js/vendor/zip.js";
import type { EpubBook } from "./types";

interface ZipLoader {
  entries: ZipEntry[];
  loadText(name: string): Promise<string> | null;
  loadBlob(name: string, type?: string): Promise<Blob> | null;
  getSize(name: string): number;
}

async function makeZipLoader(file: Blob): Promise<ZipLoader> {
  const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } = await import(
    "../../vendor/foliate-js/vendor/zip.js"
  );
  configure({ useWebWorkers: false });
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const map = new Map<string, ZipEntry>(entries.map((entry) => [entry.filename, entry]));
  const loadText = (name: string): Promise<string> | null =>
    map.has(name) ? (map.get(name)!.getData(new TextWriter()) as Promise<string>) : null;
  const loadBlob = (name: string, type?: string): Promise<Blob> | null =>
    map.has(name) ? (map.get(name)!.getData(new BlobWriter(type)) as Promise<Blob>) : null;
  const getSize = (name: string) => map.get(name)?.uncompressedSize ?? 0;
  return { entries, loadText, loadBlob, getSize };
}

export async function openBook(file: File): Promise<EpubBook> {
  if (!file.size) throw new Error("File not found");
  const [loader, { EPUB }] = await Promise.all([
    makeZipLoader(file),
    import("../../vendor/foliate-js/epub.js"),
  ]);
  const book = await new EPUB(loader).init();
  return book as EpubBook;
}
