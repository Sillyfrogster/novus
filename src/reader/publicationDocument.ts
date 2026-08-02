import {
  buildPublicationResourceUrl,
  resolvePublicationPath,
  rewritePublicationCss,
  rewritePublicationSrcset,
} from "./publicationResources";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

interface PublicationSectionSourceOptions {
  markup: string;
  mediaType: string;
  sectionPath: string;
  resourceRoot: string;
  sessionId: string;
}

export interface PublicationSectionSource {
  url: string;
  mediaType: string;
  revoke(): void;
}

function resourcePolicySource(resourceRoot: string): string {
  const root = new URL(resourceRoot);
  return root.protocol === "http:" || root.protocol === "https:"
    ? root.origin
    : root.protocol;
}

function parseSectionDocument(markup: string, mediaType: string) {
  const parser = new DOMParser();
  if (mediaType === "text/html") {
    return {
      document: parser.parseFromString(markup, "text/html"),
      mediaType: "text/html",
    };
  }

  const document = parser.parseFromString(markup, "application/xhtml+xml");
  if (
    document.querySelector("parsererror") ||
    document.documentElement?.namespaceURI !== XHTML_NAMESPACE
  ) {
    return {
      document: parser.parseFromString(markup, "text/html"),
      mediaType: "text/html",
    };
  }
  return { document, mediaType: "application/xhtml+xml" };
}

function installSectionPolicy(document: Document, resourceRoot: string): void {
  const head = document.head ?? document.querySelector("head");
  if (!head) return;

  for (const element of head.querySelectorAll("base, meta[http-equiv]")) {
    if (
      element.localName === "base" ||
      element.getAttribute("http-equiv")?.toLowerCase() === "refresh"
    ) {
      element.remove();
    }
  }

  const source = resourcePolicySource(resourceRoot);
  const policy = [
    "default-src 'none'",
    "script-src 'none'",
    "connect-src 'none'",
    `img-src data: blob: ${source}`,
    `media-src data: blob: ${source}`,
    `font-src data: ${source}`,
    `style-src 'unsafe-inline' ${source}`,
    `object-src ${source}`,
    `frame-src ${source}`,
  ].join("; ");
  const meta = document.createElementNS(XHTML_NAMESPACE, "meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", policy);
  head.prepend(meta);
}

function stripExecutableContent(document: Document): void {
  for (const script of document.querySelectorAll("script")) script.remove();
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

function rewriteProcessingInstructions(
  document: Document,
  toResourceUrl: (reference: string) => string | null,
): void {
  for (const node of [...document.childNodes]) {
    if (node.nodeType !== Node.PROCESSING_INSTRUCTION_NODE) continue;
    const instruction = node as ProcessingInstruction;
    instruction.data = instruction.data.replace(
      /(\bhref\s*=\s*["'])([^"']*)(["'])/gi,
      (match, before: string, reference: string, after: string) => {
        const url = toResourceUrl(reference);
        return url ? `${before}${url}${after}` : match;
      },
    );
  }
}

export function createPublicationSectionSource({
  markup,
  mediaType,
  sectionPath,
  resourceRoot,
  sessionId,
}: PublicationSectionSourceOptions): PublicationSectionSource {
  const parsed = parseSectionDocument(markup, mediaType);
  const document = parsed.document;
  const toResourceUrl = (reference: string): string | null => {
    if (!reference || reference.startsWith("#")) return null;
    const path = resolvePublicationPath(sectionPath, reference);
    return path
      ? buildPublicationResourceUrl(resourceRoot, sessionId, path)
      : null;
  };
  const rewriteAttribute = (element: Element, attribute: string) => {
    const reference = element.getAttribute(attribute);
    const url = reference ? toResourceUrl(reference) : null;
    if (url) element.setAttribute(attribute, url);
  };

  stripExecutableContent(document);
  rewriteProcessingInstructions(document, toResourceUrl);
  for (const element of document.querySelectorAll("link[href]")) {
    rewriteAttribute(element, "href");
  }
  for (const element of document.querySelectorAll("[src]")) {
    rewriteAttribute(element, "src");
  }
  for (const element of document.querySelectorAll("[poster]")) {
    rewriteAttribute(element, "poster");
  }
  for (const element of document.querySelectorAll("object[data]")) {
    rewriteAttribute(element, "data");
  }
  for (const element of document.querySelectorAll("image[href], use[href]")) {
    rewriteAttribute(element, "href");
  }
  for (const element of document.querySelectorAll("[*|href]:not([href])")) {
    const reference = element.getAttributeNS(XLINK_NAMESPACE, "href");
    const url = reference ? toResourceUrl(reference) : null;
    if (url) element.setAttributeNS(XLINK_NAMESPACE, "xlink:href", url);
  }
  for (const element of document.querySelectorAll("[srcset]")) {
    const srcset = element.getAttribute("srcset");
    if (srcset) {
      element.setAttribute(
        "srcset",
        rewritePublicationSrcset(srcset, sectionPath, (path) =>
          buildPublicationResourceUrl(resourceRoot, sessionId, path),
        ),
      );
    }
  }
  for (const element of document.querySelectorAll("style")) {
    if (element.textContent) {
      element.textContent = rewritePublicationCss(
        element.textContent,
        sectionPath,
        (path) => buildPublicationResourceUrl(resourceRoot, sessionId, path),
      );
    }
  }
  for (const element of document.querySelectorAll("[style]")) {
    const style = element.getAttribute("style");
    if (style) {
      element.setAttribute(
        "style",
        rewritePublicationCss(style, sectionPath, (path) =>
          buildPublicationResourceUrl(resourceRoot, sessionId, path),
        ),
      );
    }
  }

  installSectionPolicy(document, resourceRoot);
  const serialized = new XMLSerializer().serializeToString(document);
  const url = URL.createObjectURL(
    new Blob([serialized], { type: parsed.mediaType }),
  );
  let revoked = false;

  return {
    url,
    mediaType: parsed.mediaType,
    revoke() {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(url);
    },
  };
}
