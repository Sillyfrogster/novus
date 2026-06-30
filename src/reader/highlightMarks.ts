interface WrapAttrs {
  id: string;
  color: string;
  isNew: boolean;
}

/** Wrap every text-node slice covered by `range`. Returns the created marks. */
export function wrapRangeInMarks(range: Range, attrs: WrapAttrs): HTMLElement[] {
  const doc = range.startContainer.ownerDocument;
  const root = range.commonAncestorContainer;
  const rootEl = root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
  if (!doc || !rootEl) return [];

  const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (t.length > 0 && range.intersectsNode(t)) textNodes.push(t);
  }

  const marks: HTMLElement[] = [];
  for (const original of textNodes) {
    let node = original;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start >= end) continue;
    if (end < node.length) node.splitText(end);
    if (start > 0) node = node.splitText(start);

    const mark = doc.createElement("mark");
    mark.className = attrs.isNew ? "nv-hl nv-hl-new" : "nv-hl";
    mark.setAttribute("data-id", attrs.id);
    mark.setAttribute("data-color", attrs.color);
    node.parentNode?.insertBefore(mark, node);
    mark.appendChild(node);
    marks.push(mark);
  }
  return marks;
}

/** Remove all highlight marks, restoring the document to a clean text state. */
export function unwrapHighlightMarks(doc: Document): void {
  const marks = doc.querySelectorAll<HTMLElement>("mark.nv-hl");
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  doc.body?.normalize();
}
