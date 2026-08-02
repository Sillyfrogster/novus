import { describe, expect, test } from "bun:test";

import { PUBLICATION_FRAME_SANDBOX } from "../src/reader/publicationFrame";

describe("publication frame", () => {
  test("allows Novus selection listeners to run", () => {
    const permissions = PUBLICATION_FRAME_SANDBOX.split(/\s+/);

    expect(permissions).toContain("allow-same-origin");
    expect(permissions).toContain("allow-scripts");
  });
});
