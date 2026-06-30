export type Rect = { left: number; right: number };
export type RectMapper = (rect: DOMRect | Rect) => Rect;

const makeRange = (doc: Document, node: Node, start: number, end = start): Range => {
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
};

/**
 * A collapsed range sometimes returns no client rects; coerce it into a
 * non-collapsed range or an element so geometry can be read.
 */
export function uncollapse(range: Range | Node | null): Range | Node | null {
  if (!range) return range;
  if (!(range instanceof Range) || !range.collapsed) return range;
  const { endOffset, endContainer } = range;
  if (endContainer.nodeType === 1) {
    const node = endContainer.childNodes[endOffset];
    if (node?.nodeType === 1) return node;
    return endContainer;
  }
  const len = (endContainer as Text).length;
  if (endOffset + 1 < len) range.setEnd(endContainer, endOffset + 1);
  else if (endOffset > 1) range.setStart(endContainer, endOffset - 1);
  else return endContainer.parentNode;
  return range;
}

// Binary-search
const bisectNode = (
  doc: Document,
  node: Node,
  cb: (a: Range, b: Range) => number,
  start = 0,
  end = (node as Text).nodeValue?.length ?? 0,
): number => {
  if (end - start === 1) {
    const result = cb(makeRange(doc, node, start), makeRange(doc, node, end));
    return result < 0 ? start : end;
  }
  const mid = Math.floor(start + (end - start) / 2);
  const result = cb(makeRange(doc, node, start, mid), makeRange(doc, node, mid, end));
  return result < 0
    ? bisectNode(doc, node, cb, start, mid)
    : result > 0
      ? bisectNode(doc, node, cb, mid, end)
      : mid;
};

const unionRect = (target: Range | Element): DOMRect => {
  let top = Infinity,
    right = -Infinity,
    left = Infinity,
    bottom = -Infinity;
  for (const rect of target.getClientRects()) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
};

const { SHOW_ELEMENT, SHOW_TEXT, SHOW_CDATA_SECTION, FILTER_ACCEPT, FILTER_REJECT, FILTER_SKIP } =
  NodeFilter;
const filter = SHOW_ELEMENT | SHOW_TEXT | SHOW_CDATA_SECTION;

/**
 * Build a Range spanning the text currently visible within the window.
 * Used to derive both the CFI and the chapter for the current page/scroll position.
 */
export function getVisibleRange(
  doc: Document,
  start: number,
  end: number,
  mapRect: RectMapper,
): Range {
  const acceptNode = (node: Node): number => {
    const name = (node as Element).localName?.toLowerCase();
    if (name === "script" || name === "style") return FILTER_REJECT;
    if (node.nodeType === 1) {
      const { left, right } = mapRect((node as Element).getBoundingClientRect());
      if (right < start || left > end) return FILTER_REJECT;
      if (left >= start && right <= end) return FILTER_ACCEPT;
    } else {
      if (!node.nodeValue?.trim()) return FILTER_SKIP;
      const range = doc.createRange();
      range.selectNodeContents(node);
      const { left, right } = mapRect(range.getBoundingClientRect());
      if (right >= start && left <= end) return FILTER_ACCEPT;
    }
    return FILTER_SKIP;
  };

  const walker = doc.createTreeWalker(doc.body, filter, { acceptNode });
  const nodes: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);

  const from = nodes[0] ?? doc.body;
  const to = nodes[nodes.length - 1] ?? from;

  const startOffset =
    from.nodeType === 1
      ? 0
      : bisectNode(doc, from, (a, b) => {
          const p = mapRect(unionRect(a));
          const q = mapRect(unionRect(b));
          if (p.right < start && q.left > start) return 0;
          return q.left > start ? -1 : 1;
        });
  const endOffset =
    to.nodeType === 1
      ? 0
      : bisectNode(doc, to, (a, b) => {
          const p = mapRect(unionRect(a));
          const q = mapRect(unionRect(b));
          if (p.right < end && q.left > end) return 0;
          return q.left > end ? -1 : 1;
        });

  const range = doc.createRange();
  range.setStart(from, startOffset);
  range.setEnd(to, endOffset);
  return range;
}
