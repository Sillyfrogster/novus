import { beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import { collectSentences, mapRangeChars, type SentenceSeed } from "../sentences";

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM("");
  const g = globalThis as Record<string, unknown>;
  g.Node = dom.window.Node;
  g.NodeFilter = dom.window.NodeFilter;
  g.Range = dom.window.Range;
});

interface Collected {
  seeds: SentenceSeed[];
  ranges: Map<string, Range>;
}

function collect(html: string): Collected {
  const doc = dom.window.document.implementation.createHTMLDocument("t");
  doc.body.innerHTML = html;
  const ranges = new Map<string, Range>();
  let counter = 0;
  const seeds = collectSentences(doc as unknown as Document, (range) => {
    const cfi = `cfi-${counter++}`;
    ranges.set(cfi, range);
    return cfi;
  });
  return { seeds, ranges };
}

describe("collectSentences", () => {
  test("splits paragraph prose into sentences with normalized whitespace", () => {
    const { seeds } = collect(
      "<p>The captain   studied the horizon.\n  Then he turned back. Was it over?</p>",
    );
    expect(seeds.map((s) => s.text)).toEqual([
      "The captain studied the horizon.",
      "Then he turned back.",
      "Was it over?",
    ]);
  });

  test("block boundaries always end sentences", () => {
    const { seeds } = collect("<p>No terminal punctuation</p><p>Next paragraph here.</p>");
    expect(seeds.map((s) => s.text)).toEqual([
      "No terminal punctuation",
      "Next paragraph here.",
    ]);
  });

  test("headings are standalone utterances flagged isHeading", () => {
    const { seeds } = collect("<h2>Chapter One. The Sea</h2><p>It began at dawn.</p>");
    expect(seeds[0]).toMatchObject({ text: "Chapter One. The Sea", isHeading: true });
    expect(seeds[1]).toMatchObject({ text: "It began at dawn.", isHeading: false });
  });

  test("footnote reference marks are not spoken", () => {
    const { seeds } = collect("<p>The result<sup><a href='#n1'>1</a></sup> was clear.</p>");
    expect(seeds.map((s) => s.text)).toEqual(["The result was clear."]);
  });

  test("figures, captions, tables, pre and asides are skipped", () => {
    const { seeds } = collect(
      "<p>Before.</p><figure><img alt=''><figcaption>Fig 1. A map.</figcaption></figure>" +
        "<table><tr><td>cell</td></tr></table><pre>code()</pre>" +
        "<aside epub:type='footnote'>Footnote body text.</aside><p>After.</p>",
    );
    expect(seeds.map((s) => s.text)).toEqual(["Before.", "After."]);
  });

  test("inline markup does not break a sentence", () => {
    const { seeds } = collect("<p>It was <em>truly</em> a <strong>fine</strong> day.</p>");
    expect(seeds.map((s) => s.text)).toEqual(["It was truly a fine day."]);
  });

  test("verse lines split at <br> even without punctuation", () => {
    const { seeds } = collect("<p>Do not go gentle<br>into that good night<br>rage, rage</p>");
    expect(seeds.map((s) => s.text)).toEqual([
      "Do not go gentle",
      "into that good night",
      "rage, rage",
    ]);
  });

  test("punctuation-only fragments are dropped", () => {
    const { seeds } = collect("<p>Real words.</p><p>* * *</p>");
    expect(seeds.map((s) => s.text)).toEqual(["Real words."]);
  });

  test("soft hyphens and zero-width marks vanish without splitting words", () => {
    const { seeds } = collect("<p>It was com\u00ADpletely nor\u200Bmal.</p>");
    expect(seeds.map((s) => s.text)).toEqual(["It was completely normal."]);
  });

  test("empty sections yield no seeds", () => {
    expect(collect("").seeds).toEqual([]);
    expect(collect("<p>   </p>").seeds).toEqual([]);
  });

  test("sentence ranges span exactly the sentence text", () => {
    const { seeds, ranges } = collect("<p>First one here. Second one there.</p>");
    const first = ranges.get(seeds[0].cfi)!;
    const second = ranges.get(seeds[1].cfi)!;
    expect(first.toString()).toBe("First one here.");
    expect(second.toString()).toBe("Second one there.");
  });
});

describe("mapRangeChars", () => {
  test("re-derives identical normalized text from a sentence range", () => {
    const { seeds, ranges } = collect(
      "<p>The captain   studied\n the horizon. Then he turned.</p>",
    );
    for (const seed of seeds) {
      const mapped = mapRangeChars(ranges.get(seed.cfi)! as unknown as Range);
      expect(mapped.text).toBe(seed.text);
    }
  });

  test("walks through inline markup transparently", () => {
    const { seeds, ranges } = collect("<p>It was <em>truly</em> a fine day.</p>");
    const mapped = mapRangeChars(ranges.get(seeds[0].cfi)! as unknown as Range);
    expect(mapped.text).toBe("It was truly a fine day.");
  });

  test("char offsets resolve to the right DOM slices for word wrapping", () => {
    const { seeds, ranges } = collect("<p>The captain studied the horizon.</p>");
    const seed = seeds[0];
    const mapped = mapRangeChars(ranges.get(seed.cfi)! as unknown as Range);
    // "captain" occupies chars 4..11 of the normalized text.
    const start = seed.text.indexOf("captain");
    const end = start + "captain".length;
    const startSpan = mapped.spans.find((s) => start >= s.normStart && start < s.normEnd)!;
    const endSpan = mapped.spans.find((s) => end > s.normStart && end <= s.normEnd)!;
    const word = startSpan.node.data.slice(
      startSpan.start + (start - startSpan.normStart),
      endSpan.start + (end - endSpan.normStart),
    );
    expect(word).toBe("captain");
  });
});
