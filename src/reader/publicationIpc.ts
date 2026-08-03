import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import type { TocItem } from "./types";

export interface PublicationSectionDescription {
  id: string;
  href: string;
  mediaType: string;
  linear: boolean;
  spineIndex: number;
  size: number;
}

export interface OpenedPublication {
  session: string;
  savedLocator: string | null;
  packagePath: string;
  package: string;
  sections: PublicationSectionDescription[];
  contents: TocItem[];
}

export interface LoadedPublicationSection {
  index: number;
  href: string;
  mediaType: string;
  markup: string;
}

export function publicationResourceRoot(): string {
  return convertFileSrc("", "novus-epub");
}

export function openPublication(bookId: string): Promise<OpenedPublication> {
  return invoke<OpenedPublication>("publication_open", { bookId });
}

export function loadPublicationSection(
  session: string,
  index: number,
): Promise<LoadedPublicationSection> {
  return invoke<LoadedPublicationSection>("publication_section", {
    session,
    index,
  });
}

export function closePublication(session: string): Promise<void> {
  return invoke<void>("publication_close", { session });
}
