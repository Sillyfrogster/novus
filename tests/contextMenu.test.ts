import { describe, expect, test } from "bun:test";

import { blockNativeContextMenu } from "../src/lib/contextMenu";

describe("native context menu", () => {
  test("is blocked without stopping Novus event handlers", () => {
    const target = new EventTarget();
    let handled = false;
    target.addEventListener("contextmenu", () => {
      handled = true;
    });
    const unblock = blockNativeContextMenu(target);
    const event = new Event("contextmenu", { cancelable: true });

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(handled).toBe(true);
    unblock();
  });
});
