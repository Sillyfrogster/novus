import { beforeEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async () => {});

mock.module("@tauri-apps/api/core", () => ({
  invoke,
}));

const { copyImage } = await import("../src/lib/highlightExport");

describe("highlight image export", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  test("copies raw canvas pixels without a PNG conversion", async () => {
    const pixels = new Uint8ClampedArray([
      18, 20, 24, 255,
      238, 241, 246, 255,
    ]);
    const imageData = { data: pixels, height: 1, width: 2 } as ImageData;

    expect(await copyImage(imageData)).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      "copy_highlight_image",
      new Uint8Array(pixels.buffer),
      {
        headers: {
          "novus-image-height": "1",
          "novus-image-width": "2",
        },
      },
    );
  });
});
