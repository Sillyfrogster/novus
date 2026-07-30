import { createPublicationCfiBridge } from "./publicationCfi";
import { createPublicationSectionSource } from "./publicationDocument";
import {
  closePublication,
  loadPublicationSection,
  openPublication,
  publicationResourceRoot,
  type PublicationSectionDescription,
} from "./publicationIpc";
import { resolvePublicationPath } from "./publicationResources";
import type { BookModel, BookSection, ResolvedTarget } from "./types";

const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i;

function splitHref(href: string): [string, string | null] {
  const hashAt = href.indexOf("#");
  const path = hashAt < 0 ? href : href.slice(0, hashAt);
  const fragment = hashAt < 0 ? null : href.slice(hashAt + 1);
  return [path, fragment];
}

function hrefKey(href: string): string {
  const [beforeFragment] = splitHref(href);
  const questionAt = beforeFragment.indexOf("?");
  const path =
    questionAt < 0
      ? beforeFragment
      : beforeFragment.slice(0, questionAt);

  try {
    return decodeURI(path.replace(/^\/+/, ""));
  } catch {
    return path.replace(/^\/+/, "");
  }
}

function decodeFragment(fragment: string | null): string | null {
  if (fragment === null) return null;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function findFragment(document: Document, id: string): Node | null {
  return (
    document.getElementById(id) ??
    document.querySelector(`[name="${CSS.escape(id)}"]`)
  );
}

function createSection(
  description: PublicationSectionDescription & { cfi: string },
  index: number,
  sessionId: string,
  resourceRoot: string,
  isClosed: () => boolean,
): BookSection {
  let source: ReturnType<typeof createPublicationSectionSource> | null = null;
  let loading: { generation: number; promise: Promise<string> } | null = null;
  let generation = 0;

  const unload = () => {
    generation += 1;
    source?.revoke();
    source = null;
  };

  return {
    id: hrefKey(description.id),
    linear: description.linear ? undefined : "no",
    size: description.size,
    cfi: description.cfi,
    async load() {
      if (isClosed()) throw new Error("Reader is closed");
      if (source) return source.url;
      if (loading?.generation === generation) return loading.promise;

      const requestedGeneration = generation;
      const promise = loadPublicationSection(sessionId, index)
        .then((loaded) => {
          if (
            loaded.index !== index ||
            hrefKey(loaded.href) !== hrefKey(description.href)
          ) {
            throw new Error("The publication returned the wrong section");
          }

          const nextSource = createPublicationSectionSource({
            markup: loaded.markup,
            mediaType: loaded.mediaType,
            sectionPath: description.href,
            resourceRoot,
            sessionId,
          });
          if (isClosed() || generation !== requestedGeneration) {
            nextSource.revoke();
            throw new Error("Reader is closed");
          }

          source = nextSource;
          return nextSource.url;
        })
        .finally(() => {
          if (loading?.promise === promise) loading = null;
        });
      loading = { generation: requestedGeneration, promise };
      return promise;
    },
    unload,
    resolveHref(href) {
      return resolvePublicationPath(description.href, href) ?? href;
    },
  };
}

export async function openPublicationBook(bookId: string): Promise<BookModel> {
  const opened = await openPublication(bookId);

  try {
    const bridge = createPublicationCfiBridge(
      opened.package,
      opened.packagePath,
      opened.sections,
    );
    const resourceRoot = publicationResourceRoot();
    const sectionIndex = new Map(
      bridge.sections.map((section, index) => [
        hrefKey(section.href),
        index,
      ]),
    );
    let closed = false;
    const sections = bridge.sections.map((section, index) =>
      createSection(
        section,
        index,
        opened.session,
        resourceRoot,
        () => closed,
      ),
    );

    const resolveHref = (href: string): ResolvedTarget => {
      const [path, encodedFragment] = splitHref(href);
      const index = sectionIndex.get(hrefKey(path));
      if (index === undefined) {
        throw new Error("This location is not in the publication");
      }

      const fragment = decodeFragment(encodedFragment);
      return fragment === null
        ? { index }
        : {
            index,
            anchor: (document) =>
              findFragment(document, fragment) ?? document.body,
          };
    };

    return {
      sections,
      toc: opened.contents,
      resolveCFI(cfi) {
        const resolved = bridge.resolve(cfi);
        if (!resolved) throw new Error("This reading position is not valid");
        return resolved;
      },
      resolveHref,
      splitTOCHref(href) {
        if (!href) return ["", null];
        const [path, fragment] = splitHref(href);
        return [hrefKey(path), decodeFragment(fragment)];
      },
      getTOCFragment(document, id) {
        return id === null ? null : findFragment(document, id);
      },
      isExternal(uri) {
        return URI_SCHEME.test(uri) && !/^blob:/i.test(uri);
      },
      destroy() {
        if (closed) return;
        closed = true;
        for (const section of sections) section.unload?.();
        void closePublication(opened.session).catch(() => {});
      },
    };
  } catch (error) {
    await closePublication(opened.session).catch(() => {});
    throw error;
  }
}
