import { describe, expect, test } from "bun:test";

import {
  resolveContentsTarget,
  restoreReaderPosition,
} from "../src/reader/navigation";
import type { TocItem } from "../src/reader/types";
import { MemoryReaderSession } from "./fakes/MemoryReaderSession";

const contents: TocItem[] = [
  {
    label: "Part one",
    href: "OPS/part-one.xhtml",
    subitems: [
      {
        label: "Second chapter",
        href: "OPS/chapters/chapter-02.xhtml#start",
      },
    ],
  },
  {
    label: "Part two",
    href: "OPS/part-two.xhtml",
  },
];

describe("reader contents navigation", () => {
  test("uses the EPUB contents path for a matching file name", () => {
    expect(resolveContentsTarget(contents, "part-two.xhtml")).toBe(
      "OPS/part-two.xhtml",
    );
  });

  test("finds matching entries inside nested contents", () => {
    expect(
      resolveContentsTarget(contents, "chapter-02.xhtml#start"),
    ).toBe("OPS/chapters/chapter-02.xhtml#start");
  });

  test("keeps locators and unknown links unchanged", () => {
    const locator = "epubcfi(/6/4!/4/2/1:0)";
    expect(resolveContentsTarget(contents, locator)).toBe(locator);
    expect(resolveContentsTarget(contents, "missing.xhtml")).toBe(
      "missing.xhtml",
    );
  });

  test("restores a nested contents target through the reader session", async () => {
    const reader = new MemoryReaderSession(contents);

    expect(
      await restoreReaderPosition(reader, contents, "chapter-02.xhtml#start"),
    ).toBe(true);
    expect(reader.destinations).toEqual([
      {
        kind: "target",
        value: "OPS/chapters/chapter-02.xhtml#start",
      },
    ]);
  });

  test("starts at the beginning when a saved target is stale", async () => {
    const reader = new MemoryReaderSession(contents);

    expect(
      await restoreReaderPosition(reader, contents, "missing.xhtml"),
    ).toBe(true);
    expect(reader.destinations).toEqual([
      { kind: "target", value: "missing.xhtml" },
      { kind: "start" },
    ]);
  });

  test("does not fall back after the reader closes", async () => {
    const reader = new MemoryReaderSession(contents);
    const controller = new AbortController();
    controller.abort();

    expect(
      await restoreReaderPosition(
        reader,
        contents,
        "missing.xhtml",
        controller.signal,
      ),
    ).toBe(false);
    expect(reader.destinations).toEqual([]);
  });
});
