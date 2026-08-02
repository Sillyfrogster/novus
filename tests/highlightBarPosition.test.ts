import { describe, expect, test } from "bun:test";

import { placeHighlightBar } from "../src/components/reader/highlightBarPosition";

describe("highlight toolbar position", () => {
  test("keeps WebKit selection coordinates inside the viewport", () => {
    expect(
      placeHighlightBar(
        { top: 980, bottom: 1018, left: 240, right: 420 },
        { width: 880, height: 640 },
      ),
    ).toEqual({ left: 238, top: 588 });
  });
});
