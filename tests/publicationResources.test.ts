import { describe, expect, test } from "bun:test";

import {
  buildPublicationResourceUrl,
  resolvePublicationPath,
  rewritePublicationCss,
  rewritePublicationSrcset,
} from "../src/reader/publicationResources";

const ROOT = "novus-resource://reader";
const SESSION = "session one";
const toResourceUrl = (path: string) =>
  buildPublicationResourceUrl(ROOT, SESSION, path);

describe("publication paths", () => {
  test("resolves and encodes local references once", () => {
    expect(
      resolvePublicationPath(
        "OPS/Text/chapter%201.xhtml",
        "../Images/café cover%202x.png?mode=fit#front page",
      ),
    ).toBe(
      "OPS/Images/caf%C3%A9%20cover%202x.png?mode=fit#front%20page",
    );
  });

  test("keeps fragments on the current section", () => {
    expect(resolvePublicationPath("OPS/Text/chapter.xhtml", "#note-1")).toBe(
      "OPS/Text/chapter.xhtml#note-1",
    );
  });

  test("rejects references that leave the publication", () => {
    expect(
      resolvePublicationPath("OPS/Text/chapter.xhtml", "../../../secret.txt"),
    ).toBeNull();
    expect(
      resolvePublicationPath(
        "OPS/Text/chapter.xhtml",
        "%2e%2e/%2e%2e/%2e%2e/secret.txt",
      ),
    ).toBeNull();
    expect(
      resolvePublicationPath("OPS/Text/chapter.xhtml", "../Images%2Fsecret.png"),
    ).toBeNull();
  });

  test("builds a custom-protocol URL without double encoding", () => {
    expect(
      buildPublicationResourceUrl(
        "novus-resource://reader/assets",
        "session /一",
        "OPS/Images/caf%C3%A9%20cover.png#front",
      ),
    ).toBe(
      "novus-resource://reader/assets/session%20%2F%E4%B8%80/OPS/Images/caf%C3%A9%20cover.png#front",
    );
  });
});

describe("publication CSS", () => {
  test("rewrites quoted URLs with parentheses and surrounding comments", () => {
    const css =
      'figure { background: url(/* cover */ "../Images/cover (final).png#art" /* end */); }';

    expect(
      rewritePublicationCss(css, "OPS/Styles/book.css", toResourceUrl),
    ).toBe(
      'figure { background: url(/* cover */ "novus-resource://reader/session%20one/OPS/Images/cover%20(final).png#art" /* end */); }',
    );
  });

  test("decodes CSS escapes and rewrites string imports", () => {
    const css =
      '@import /* theme */ "theme\\20 dark.css" screen;\n.icon { background: url(../Images/chapter\\(1\\).png); }';

    expect(
      rewritePublicationCss(css, "OPS/Styles/book.css", toResourceUrl),
    ).toBe(
      '@import /* theme */ "novus-resource://reader/session%20one/OPS/Styles/theme%20dark.css" screen;\n.icon { background: url("novus-resource://reader/session%20one/OPS/Images/chapter(1).png"); }',
    );
  });

  test("leaves comments, ordinary strings, fragments, and data URLs alone", () => {
    const css =
      '/* url("../Images/no.png") */\n.note::before { content: "url(../Images/no.png)"; }\n.mask { mask: url(#shape); }\n.inline { background: url("data:image/svg+xml,%3Csvg%3E"); }';

    expect(
      rewritePublicationCss(css, "OPS/Styles/book.css", toResourceUrl),
    ).toBe(css);
  });
});

describe("publication srcset", () => {
  test("keeps commas inside data URLs while rewriting later candidates", () => {
    const srcset =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA 1x, ../Images/cover%20one.png 2x";

    expect(
      rewritePublicationSrcset(srcset, "OPS/Text/chapter.xhtml", toResourceUrl),
    ).toBe(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA 1x, novus-resource://reader/session%20one/OPS/Images/cover%20one.png 2x",
    );
  });

  test("handles a data URL followed directly by a candidate separator", () => {
    const srcset =
      "data:image/svg+xml,%3Csvg%3E, ../Images/second.png 2x";

    expect(
      rewritePublicationSrcset(srcset, "OPS/Text/chapter.xhtml", toResourceUrl),
    ).toBe(
      "data:image/svg+xml,%3Csvg%3E, novus-resource://reader/session%20one/OPS/Images/second.png 2x",
    );
  });
});
