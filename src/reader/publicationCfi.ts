import * as CFI from "../../vendor/foliate-js/epubcfi.js";

const OPF_NAMESPACE = "http://www.idpf.org/2007/opf";

interface CfiStep {
  id?: string | null;
  index: number;
}

type CfiPath = CfiStep[];
type ParsedCfi = CfiPath[] & { parent?: CfiPath[] };

interface CfiModule {
  fromElements(elements: readonly Element[]): string[];
  toElement(document: Document, path: CfiPath): Element | null;
}

interface SpineSection {
  spineIndex: number;
}

interface CfiSection extends SpineSection {
  cfi: string;
}

interface ResolvedCfi {
  index: number;
  anchor: (document: Document) => Range;
}

function packageElementMatcher(document: Document) {
  const usesNamespace =
    document.lookupNamespaceURI(null) === OPF_NAMESPACE ||
    Boolean(document.lookupPrefix(OPF_NAMESPACE));

  return (element: Element, name: string) =>
    element.localName === name &&
    (!usesNamespace || element.namespaceURI === OPF_NAMESPACE);
}

export function createPublicationCfiBridge<T extends SpineSection>(
  packageXml: string,
  packagePath: string,
  sections: readonly T[],
): {
  sections: (T & CfiSection)[];
  resolve(cfi: string): ResolvedCfi | null;
} {
  const packageDocument = new DOMParser().parseFromString(
    packageXml,
    "application/xml",
  );
  if (packageDocument.querySelector("parsererror")) {
    throw new Error(`Could not read the EPUB package: ${packagePath}`);
  }

  const matches = packageElementMatcher(packageDocument);
  const spine = [...packageDocument.documentElement.children].find((element) =>
    matches(element, "spine"),
  );
  if (!spine) throw new Error("This EPUB has no reading order");

  const itemrefs = [...spine.children].filter((element) =>
    matches(element, "itemref"),
  );
  if (itemrefs.length === 0) throw new Error("This EPUB has an empty reading order");

  const compat = CFI as typeof CFI & CfiModule;
  const bases = compat.fromElements(itemrefs);
  const bridgedSections = sections.map((section) => {
    const cfi = bases[section.spineIndex];
    if (!Number.isSafeInteger(section.spineIndex) || !cfi) {
      throw new Error("This EPUB has an invalid reading order");
    }
    return { ...section, cfi };
  });
  const sectionBySpineIndex = new Map(
    bridgedSections.map((section, index) => [section.spineIndex, index]),
  );

  const resolve = (value: string): ResolvedCfi | null => {
    try {
      const parsed = CFI.parse(value) as ParsedCfi;
      const packagePaths = parsed.parent ?? parsed;
      const top = packagePaths.shift();
      if (!top) return null;

      let itemref = compat.toElement(packageDocument, top);
      if (itemref && itemref.nodeName !== "idref") {
        const finalStep = top[top.length - 1];
        if (finalStep) finalStep.id = null;
        itemref = compat.toElement(packageDocument, top);
      }

      const idref = itemref?.getAttribute("idref");
      const spineIndex = itemrefs.findIndex(
        (candidate) => candidate.getAttribute("idref") === idref,
      );
      const index = sectionBySpineIndex.get(spineIndex);
      if (index === undefined) return null;

      return {
        index,
        anchor: (document) => CFI.toRange(document, parsed),
      };
    } catch {
      return null;
    }
  };

  return { sections: bridgedSections, resolve };
}
