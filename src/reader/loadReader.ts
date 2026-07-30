import type { ReaderFactory } from "./contract";

export async function loadReaderFactory(): Promise<ReaderFactory> {
  const { NovusRenderer } = await import("./NovusRenderer");
  return (host) => new NovusRenderer(host);
}
