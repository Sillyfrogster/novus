import { describe, expect, test } from "bun:test";

import { bindSelectionEvents } from "../src/reader/selectionEvents";

describe("reader selection events", () => {
  test("finishes a selection when the document reports a change", async () => {
    const document = new EventTarget();
    let finishes = 0;
    const unbind = bindSelectionEvents(document, {
      onStart: () => {},
      onFinish: () => finishes++,
    });

    document.dispatchEvent(new Event("selectionchange"));
    await Bun.sleep(100);

    expect(finishes).toBe(1);
    unbind();
  });

  test("reports a mouse selection only once", async () => {
    const document = new EventTarget();
    let finishes = 0;
    const unbind = bindSelectionEvents(document, {
      onStart: () => {},
      onFinish: () => finishes++,
    });

    document.dispatchEvent(new Event("selectionchange"));
    document.dispatchEvent(new Event("mouseup"));
    await Bun.sleep(100);

    expect(finishes).toBe(1);
    unbind();
  });

  test("finishes when WebKit reports a pointer release", () => {
    const document = new EventTarget();
    let finishes = 0;
    const unbind = bindSelectionEvents(document, {
      onStart: () => {},
      onFinish: () => finishes++,
    });

    document.dispatchEvent(new Event("pointerup"));

    expect(finishes).toBe(1);
    unbind();
  });

  test("coalesces pointer and mouse release events", () => {
    const document = new EventTarget();
    let finishes = 0;
    const unbind = bindSelectionEvents(document, {
      onStart: () => {},
      onFinish: () => finishes++,
    });

    document.dispatchEvent(new Event("pointerup"));
    document.dispatchEvent(new Event("mouseup"));

    expect(finishes).toBe(1);
    unbind();
  });
});
