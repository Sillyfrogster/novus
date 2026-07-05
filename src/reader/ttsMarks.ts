import type { WordTiming } from "../lib/ipc";
import { mapTextNodes, type CharSpan } from "./sentences";

/**
 * Follow-along marks for read-aloud.
 */
export class TtsMarks {
  #doc: Document | null = null;
  #wordMarks: HTMLElement[][] = [];
  #timings: WordTiming[] = [];
  #activeWord = -1;

  /** Returns true when word-level marks are in place (false = wash only). */
  beginSentence(range: Range, sentenceText: string, timings: WordTiming[]): boolean {
    this.clear();
    const doc = range.startContainer.ownerDocument;
    if (!doc) return false;
    this.#doc = doc;

    const washMarks = wrapRange(range, "nv-tts");
    if (washMarks.length === 0) return false;
    if (timings.length === 0) return false;

    const slices = washMarks
      .map((mark) => mark.firstChild)
      .filter((n): n is Text => n?.nodeType === Node.TEXT_NODE);
    const mapped = mapTextNodes(slices);
    if (mapped.text !== sentenceText) {
      return false;
    }

    const perWord = timings.map((t) => sliceSpans(mapped.spans, t.startChar, t.endChar));
    this.#wordMarks = timings.map(() => []);
    for (let i = perWord.length - 1; i >= 0; i--) {
      for (let j = perWord[i].length - 1; j >= 0; j--) {
        const { node, start, end } = perWord[i][j];
        if (start >= end) continue;
        let target = node;
        if (end < target.length) target.splitText(end);
        if (start > 0) target = target.splitText(start);
        const mark = doc.createElement("mark");
        mark.className = "nv-tts-w";
        mark.setAttribute("data-wi", String(i));
        target.parentNode?.insertBefore(mark, target);
        mark.appendChild(target);
        this.#wordMarks[i].unshift(mark);
      }
    }
    this.#timings = timings;
    this.#activeWord = -1;
    return true;
  }

  /**
   * Advance the active word for the given playback position.
   * Returns the newly active word's first mark when it changed, else null.
   */
  setActive(elapsedMs: number): HTMLElement | null {
    const timings = this.#timings;
    if (timings.length === 0) return null;
    let index = this.#activeWord;
    if (index < 0 || elapsedMs < timings[index].startMs) index = 0;
    while (index < timings.length - 1 && elapsedMs >= timings[index + 1].startMs) index++;
    if (elapsedMs < timings[index].startMs) return null; // pre-roll silence
    if (index === this.#activeWord) return null;

    if (this.#activeWord >= 0) {
      for (const mark of this.#wordMarks[this.#activeWord] ?? []) {
        mark.classList.remove("nv-tts-on");
      }
    }
    for (const mark of this.#wordMarks[index] ?? []) mark.classList.add("nv-tts-on");
    this.#activeWord = index;
    return this.#wordMarks[index]?.[0] ?? null;
  }

  /** Remove every follow-along mark and restore clean text. */
  clear(): void {
    const doc = this.#doc;
    this.#wordMarks = [];
    this.#timings = [];
    this.#activeWord = -1;
    if (!doc) return;
    for (const mark of doc.querySelectorAll<HTMLElement>("mark.nv-tts-w, mark.nv-tts")) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    }
    doc.body?.normalize();
  }
}

interface NodeSlice {
  node: Text;
  start: number;
  end: number;
}

/** DOM slices covering [startChar, endChar) of the normalized text. */
function sliceSpans(spans: CharSpan[], startChar: number, endChar: number): NodeSlice[] {
  const slices: NodeSlice[] = [];
  for (const span of spans) {
    const from = Math.max(startChar, span.normStart);
    const to = Math.min(endChar, span.normEnd);
    if (from >= to) continue;
    slices.push({
      node: span.node,
      start: span.start + (from - span.normStart),
      end: span.start + (to - span.normStart),
    });
  }
  return slices;
}

/** Wrap every text-node slice covered by `range` in a mark of `className`. */
function wrapRange(range: Range, className: string): HTMLElement[] {
  const doc = range.startContainer.ownerDocument;
  const root = range.commonAncestorContainer;
  const rootEl = root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
  if (!doc || !rootEl) return [];

  const nodeRange = doc.createRange();
  const intersects = (node: Text): boolean => {
    nodeRange.selectNodeContents(node);
    return (
      range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0
    );
  };

  const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (t.length > 0 && intersects(t)) textNodes.push(t);
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
    mark.className = className;
    node.parentNode?.insertBefore(mark, node);
    mark.appendChild(node);
    marks.push(mark);
  }
  return marks;
}
