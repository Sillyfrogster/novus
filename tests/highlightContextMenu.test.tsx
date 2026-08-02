import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  clampMenuPosition,
  HighlightContextMenu,
} from "../src/views/Library/HighlightContextMenu";

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { innerHeight: 720, innerWidth: 1080 },
});

const doNothing = () => {};

describe("highlight context menu", () => {
  test("stays inside the viewport", () => {
    expect(clampMenuPosition(1070, 710, 226, 280, 1080, 720)).toEqual({
      left: 842,
      top: 428,
    });
    expect(clampMenuPosition(-20, -30, 226, 280, 1080, 720)).toEqual({
      left: 12,
      top: 12,
    });
  });

  test("uses a top-layer dialog with separate image actions", () => {
    const markup = renderToStaticMarkup(
      <HighlightContextMenu
        x={200}
        y={180}
        onDetails={doNothing}
        onCopy={doNothing}
        onCopyImage={doNothing}
        onSaveImage={doNothing}
        onExportMarkdown={doNothing}
        onExportObsidian={doNothing}
        onDelete={doNothing}
        onClose={doNothing}
      />,
    );

    expect(markup.startsWith("<dialog")).toBe(true);
    expect(markup).toContain("Copy as image");
    expect(markup).toContain("Save image…");
  });
});
