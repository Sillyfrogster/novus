import { describe, expect, test } from "bun:test";

import { FrameBatch } from "../src/reader/FrameBatch";

function controlledFrames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;

  return {
    request(callback: FrameRequestCallback): number {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle: number): void {
      callbacks.delete(handle);
    },
    flush(): void {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(0);
    },
    get size(): number {
      return callbacks.size;
    },
  };
}

describe("reader frame batching", () => {
  test("runs only the latest task in a frame", () => {
    const frames = controlledFrames();
    const batch = new FrameBatch(frames.request, frames.cancel);
    const values: number[] = [];

    batch.schedule(() => values.push(1));
    batch.schedule(() => values.push(2));

    expect(frames.size).toBe(1);
    frames.flush();
    expect(values).toEqual([2]);
  });

  test("can schedule another frame after flushing", () => {
    const frames = controlledFrames();
    const batch = new FrameBatch(frames.request, frames.cancel);
    let runs = 0;

    batch.schedule(() => runs++);
    frames.flush();
    batch.schedule(() => runs++);
    frames.flush();

    expect(runs).toBe(2);
  });

  test("clears work that has not run", () => {
    const frames = controlledFrames();
    const batch = new FrameBatch(frames.request, frames.cancel);
    let ran = false;

    batch.schedule(() => {
      ran = true;
    });
    batch.clear();
    frames.flush();

    expect(ran).toBe(false);
  });
});
