import type { ReaderSurface } from "./types";

export type ReaderFactory = (host: HTMLElement) => ReaderSurface;

export async function loadReaderFactory(): Promise<ReaderFactory> {
  const { NovusRenderer } = await import("./NovusRenderer");
  return (host) => new NovusRenderer(host);
}
