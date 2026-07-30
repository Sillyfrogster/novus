import { describe, expect, test } from "bun:test";

import { resolveContentsTarget } from "../src/reader/navigation";
import type { TocItem } from "../src/reader/types";

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
});
