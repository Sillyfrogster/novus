import { beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import type { WordTiming } from "../../lib/ipc";
import { TtsMarks } from "../ttsMarks";

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM("");
  const g = globalThis as Record<string, unknown>;
  g.Node = dom.window.Node;
  g.NodeFilter = dom.window.NodeFilter;
  g.Range = dom.window.Range;
});

function sentenceRange(html: string): { doc: Document; range: Range } {
  const doc = dom.window.document.implementation.createHTMLDocument("t");
  doc.body.innerHTML = html;
  const p = doc.body.querySelector("p")!;
  const range = doc.createRange();
  range.selectNodeContents(p);
  return { doc: doc as unknown as Document, range: range as unknown as Range };
}

function timingsFor(text: string): WordTiming[] {
  // One timing per whitespace-delimited word, 100ms each, punctuation attached.
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

describe("TtsMarks", () => {
  test("wraps the sentence wash and per-word marks with correct text", () => {
    const text = "The captain studied the horizon.";
    const { doc, range } = sentenceRange(`<p>${text}</p>`);
    const marks = new TtsMarks();
    const wordLevel = marks.beginSentence(range, text, timingsFor(text));
    expect(wordLevel).toBe(true);

    const words = Array.from(doc.querySelectorAll("mark.nv-tts-w")).map((m) => m.textContent);
    expect(words).toEqual(["The", "captain", "studied", "the", "horizon."]);
    expect(doc.querySelectorAll("mark.nv-tts").length).toBeGreaterThan(0);
    expect(doc.body.textContent).toBe(text);
  });

  test("word marks survive inline markup crossing word boundaries", () => {
    const { doc, range } = sentenceRange("<p>It was <em>truly</em> fine.</p>");
    const text = "It was truly fine.";
    const marks = new TtsMarks();
    expect(marks.beginSentence(range, text, timingsFor(text))).toBe(true);
    const words = Array.from(doc.querySelectorAll("mark.nv-tts-w")).map((m) => m.textContent);
    expect(words).toEqual(["It", "was", "truly", "fine."]);
  });

  test("setActive toggles exactly one active word as time advances", () => {
    const text = "One two three.";
    const { doc, range } = sentenceRange(`<p>${text}</p>`);
    const marks = new TtsMarks();
    marks.beginSentence(range, text, timingsFor(text));

    expect(marks.setActive(10)).not.toBeNull(); // "One" becomes active
    expect(doc.querySelectorAll(".nv-tts-on").length).toBe(1);
    expect(doc.querySelector(".nv-tts-on")!.textContent).toBe("One");

    expect(marks.setActive(50)).toBeNull(); // still "One": no change
    expect(marks.setActive(150)).not.toBeNull(); // "two"
    expect(doc.querySelector(".nv-tts-on")!.textContent).toBe("two");
    expect(doc.querySelectorAll(".nv-tts-on").length).toBe(1);

    expect(marks.setActive(250)).not.toBeNull(); // "three."
    expect(doc.querySelector(".nv-tts-on")!.textContent).toBe("three.");
  });

  test("mismatched text degrades to wash-only instead of mis-highlighting", () => {
    const text = "Completely different sentence.";
    const { doc, range } = sentenceRange("<p>The real page text here.</p>");
    const marks = new TtsMarks();
    expect(marks.beginSentence(range, text, timingsFor(text))).toBe(false);
    expect(doc.querySelectorAll("mark.nv-tts-w").length).toBe(0);
    expect(doc.querySelectorAll("mark.nv-tts").length).toBeGreaterThan(0);
  });

  test("clear removes every mark and restores clean text", () => {
    const text = "The captain studied the horizon.";
    const { doc, range } = sentenceRange(`<p>${text}</p>`);
    const marks = new TtsMarks();
    marks.beginSentence(range, text, timingsFor(text));
    marks.setActive(150);
    marks.clear();
    expect(doc.querySelectorAll("mark").length).toBe(0);
    expect(doc.body.textContent).toBe(text);
  });
});
