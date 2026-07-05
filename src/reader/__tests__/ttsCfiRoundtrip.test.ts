import { beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import * as CFI from "../../../vendor/foliate-js/epubcfi.js";
import type { WordTiming } from "../../lib/ipc";
import { collectSentences } from "../sentences";
import { TtsMarks } from "../ttsMarks";

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM("");
  const g = globalThis as Record<string, unknown>;
  g.Node = dom.window.Node;
  g.NodeFilter = dom.window.NodeFilter;
  g.Range = dom.window.Range;
});

/** Same filter as NovusRenderer's cfiFilter. */
const cfiFilter = (node: Node): number => {
  if (node.nodeType !== 1) return dom.window.NodeFilter.FILTER_ACCEPT;
  const classList = (node as Element).classList;
  return classList?.contains("nv-hl") ||
    classList?.contains("nv-tts") ||
    classList?.contains("nv-tts-w")
    ? dom.window.NodeFilter.FILTER_SKIP
    : dom.window.NodeFilter.FILTER_ACCEPT;
};

function timingsFor(text: string): WordTiming[] {
  const timings: WordTiming[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  let t = 0;
  while ((match = re.exec(text))) {
    timings.push({
      startMs: t,
      endMs: t + 100,
      startChar: match.index,
      endChar: match.index + match[0].length,
    });
    t += 100;
  }
  return timings;
}

describe("sentence CFI roundtrip during playback", () => {
  test("consecutive sentences resolve and mark correctly while prior marks exist", () => {
    const doc = dom.window.document.implementation.createHTMLDocument("t");
    doc.body.innerHTML =
      "<section><p>The captain studied the horizon for a long moment. " +
      "Then he turned back to his <em>crew</em>. " +
      "Forty-two ships had left the harbor.</p></section>";

    const seeds = collectSentences(doc as unknown as Document, (range) =>
      CFI.fromRange(range as unknown as Range, cfiFilter),
    );
    expect(seeds.length).toBe(3);

    const marks = new TtsMarks();
    const resolve = (cfi: string): Range =>
      CFI.toRange(doc as unknown as Document, CFI.parse(cfi), cfiFilter) as unknown as Range;

    for (const seed of seeds) {
      marks.clear();
      const range = resolve(seed.cfi);
      expect(range).toBeTruthy();
      expect(range.toString().replace(/\s+/g, " ").trim()).toBe(seed.text);
      const wordLevel = marks.beginSentence(range, seed.text, timingsFor(seed.text));
      expect(wordLevel).toBe(true);
      marks.setActive(10);
      expect(doc.querySelectorAll(".nv-tts-on").length).toBeGreaterThan(0);
    }

    marks.clear();
    expect(doc.querySelectorAll("mark").length).toBe(0);
  });

  test("regression: resolving without clearing first mangles from sentence two on", () => {
    const doc = dom.window.document.implementation.createHTMLDocument("t");
    doc.body.innerHTML = "<p>First sentence here. Second sentence there.</p>";
    const seeds = collectSentences(doc as unknown as Document, (range) =>
      CFI.fromRange(range as unknown as Range, cfiFilter),
    );
    const marks = new TtsMarks();

    const r1 = CFI.toRange(doc as unknown as Document, CFI.parse(seeds[0].cfi), cfiFilter);
    marks.beginSentence(r1 as unknown as Range, seeds[0].text, timingsFor(seeds[0].text));

    const r2 = CFI.toRange(doc as unknown as Document, CFI.parse(seeds[1].cfi), cfiFilter);
    expect((r2 as unknown as Range).toString().replace(/\s+/g, " ").trim()).toBe(seeds[1].text);
  });
});
