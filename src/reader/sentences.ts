/**
 * Sentence extraction for read-aloud.
 */

export interface SentenceSeed {
  text: string;
  cfi: string;
  isHeading: boolean;
}

export interface CharSpan {
  node: Text;
  start: number;
  end: number;
  normStart: number;
  normEnd: number;
}

export interface NormalizedText {
  text: string;
  spans: CharSpan[];
}

/** Containers that are never spoken. */
const SKIP_SELECTOR = [
  "script",
  "style",
  "template",
  "noscript",
  "sup",
  "table",
  "figure",
  "figcaption",
  "pre",
  "nav",
  "aside",
  "[hidden]",
  '[aria-hidden="true"]',
].join(",");

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,td,th,div,section,article,header,footer,main";
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
const HARD_BREAK = "";

/**
 * Characters dropped from normalized text without becoming a space.
 */
const DROPPED_CHAR = /[\u00AD\u200B\u200C\u200D\uFEFF]/;

interface Block {
  element: Element;
  norm: NormalizedBuilder;
}

/** Incrementally builds whitespace-collapsed text with a map back to DOM offsets. */
class NormalizedBuilder {
  text = "";
  spans: CharSpan[] = [];
  #pendingSpace = false;

  /** Append node.data[from..to), collapsing whitespace; spans keep true node offsets. */
  appendText(node: Text, from = 0, to = node.data.length): void {
    const data = node.data;
    let runStart = -1;
    const flushRun = (endExclusive: number) => {
      if (runStart < 0) return;
      if (this.#pendingSpace && this.text.length > 0) this.text += " ";
      this.#pendingSpace = false;
      const normStart = this.text.length;
      this.text += data.slice(runStart, endExclusive);
      this.spans.push({
        node,
        start: runStart,
        end: endExclusive,
        normStart,
        normEnd: this.text.length,
      });
      runStart = -1;
    };
    for (let i = from; i < to; i++) {
      if (DROPPED_CHAR.test(data[i])) {
        flushRun(i);
      } else if (/\s/.test(data[i])) {
        flushRun(i);
        this.#pendingSpace = true;
      } else if (runStart < 0) {
        runStart = i;
      }
    }
    flushRun(to);
  }

  appendHardBreak(): void {
    if (this.text.length > 0 && !this.text.endsWith(HARD_BREAK)) {
      this.text += HARD_BREAK;
      this.#pendingSpace = false;
    }
  }

  /** DOM position for a normalized-text offset (start side). */
  domStart(normOffset: number): { node: Text; offset: number } | null {
    for (const span of this.spans) {
      if (normOffset >= span.normStart && normOffset < span.normEnd) {
        return { node: span.node, offset: span.start + (normOffset - span.normStart) };
      }
    }
    return null;
  }

  /** DOM position for a normalized-text offset (end side, exclusive). */
  domEnd(normOffset: number): { node: Text; offset: number } | null {
    for (const span of this.spans) {
      if (normOffset > span.normStart && normOffset <= span.normEnd) {
        return { node: span.node, offset: span.start + (normOffset - span.normStart) };
      }
    }
    return null;
  }
}

function isSkipped(node: Node): boolean {
  return node.parentElement?.closest(SKIP_SELECTOR) != null;
}

function blockAncestor(node: Node, root: Element): Element {
  return node.parentElement?.closest(BLOCK_SELECTOR) ?? root;
}

/**
 * Collect the section's sentences in reading order.
 */
export function collectSentences(
  doc: Document,
  cfiFromRange: (range: Range) => string | null,
  probe?: (range: Range, index: number) => void,
): SentenceSeed[] {
  const body = doc.body;
  if (!body) return [];

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node: Node): number {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (el.matches(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return el.localName === "br" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      if (!(node as Text).data) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const seeds: SentenceSeed[] = [];
  let block: Block | null = null;

  const flush = () => {
    if (block) emitBlock(doc, block, seeds, cfiFromRange, probe);
    block = null;
  };

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      block?.norm.appendHardBreak();
      continue;
    }
    const text = node as Text;
    if (isSkipped(text)) continue;
    const element = blockAncestor(text, body);
    if (!block || block.element !== element) {
      flush();
      block = { element, norm: new NormalizedBuilder() };
    }
    block.norm.appendText(text);
  }
  flush();
  return seeds;
}

function emitBlock(
  doc: Document,
  block: Block,
  seeds: SentenceSeed[],
  cfiFromRange: (range: Range) => string | null,
  probe?: (range: Range, index: number) => void,
): void {
  const { norm } = block;
  if (!norm.text.trim()) return;
  const isHeading = HEADING_TAGS.has(block.element.localName);

  const emit = (normStart: number, normEnd: number) => {
    let start = normStart;
    let end = normEnd;
    const text = norm.text;
    while (start < end && (/\s/.test(text[start]) || text[start] === HARD_BREAK)) start++;
    while (end > start && (/\s/.test(text[end - 1]) || text[end - 1] === HARD_BREAK)) end--;
    if (end - start === 0) return;
    const sentence = text.slice(start, end);
    if (!/\p{L}|\p{N}/u.test(sentence)) return;

    const from = norm.domStart(start);
    const to = norm.domEnd(end);
    if (!from || !to) return;
    const range = doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const cfi = cfiFromRange(range);
    if (cfi) {
      seeds.push({ text: sentence, cfi, isHeading });
      probe?.(range, seeds.length - 1);
    }
  };

  if (isHeading) {
    emit(0, norm.text.length);
    return;
  }

  let lineStart = 0;
  const lines: Array<{ start: number; end: number }> = [];
  for (let i = 0; i <= norm.text.length; i++) {
    if (i === norm.text.length || norm.text[i] === HARD_BREAK) {
      if (i > lineStart) lines.push({ start: lineStart, end: i });
      lineStart = i + 1;
    }
  }
  for (const line of lines) {
    const lineText = norm.text.slice(line.start, line.end);
    for (const segment of segmenter.segment(lineText)) {
      emit(line.start + segment.index, line.start + segment.index + segment.segment.length);
    }
  }
}

export function mapRangeChars(range: Range): NormalizedText {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return { text: "", spans: [] };
  const norm = new NormalizedBuilder();
  const intersects = (node: Node): boolean => {
    const nodeRange = doc.createRange();
    nodeRange.selectNodeContents(node);
    return (
      range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0
    );
  };

  const root = range.commonAncestorContainer;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      if (!intersects(node)) return NodeFilter.FILTER_REJECT;
      if (isSkipped(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) {
    nodes.push(root as Text);
  } else {
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push(node as Text);
    }
  }

  for (const node of nodes) {
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.length;
    norm.appendText(node, from, to);
  }

  return { text: norm.text, spans: norm.spans };
}

export function mapTextNodes(nodes: Text[]): NormalizedText {
  const norm = new NormalizedBuilder();
  for (const node of nodes) norm.appendText(node);
  return { text: norm.text, spans: norm.spans };
}
