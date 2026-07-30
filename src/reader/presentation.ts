import { HIGHLIGHT_COLOR_KEYS, tintFor } from "../lib/highlightColors";
import type { ReadFont } from "../lib/types";
import type { ReaderPresentation } from "./contract";

const FONT_STACKS: Record<ReadFont, string> = {
  serif: "'Lora', Georgia, 'Times New Roman', serif",
  sans: "'Hanken Grotesk', system-ui, sans-serif",
  modern: "'Source Serif 4', Georgia, serif",
};

const THEMES: Record<
  ReaderPresentation["readTheme"],
  { background: string; foreground: string }
> = {
  light: { background: "#f4f5f7", foreground: "#1b1d23" },
  sepia: { background: "#ece1cf", foreground: "#433a2b" },
  dark: { background: "#0c0d10", foreground: "#c9ccd4" },
};

function highlightCss(presentation: ReaderPresentation): string {
  const slots = HIGHLIGHT_COLOR_KEYS.map(
    (key) =>
      `mark.nv-hl[data-color="${key}"] { background-image: linear-gradient(${tintFor(presentation.highlightColors[key])}, ${tintFor(presentation.highlightColors[key])}); }`,
  ).join("\n");

  return `
    mark.nv-hl {
      color: inherit !important;
      background-color: transparent;
      background-repeat: no-repeat;
      background-position: 0 0;
      background-size: 100% 100%;
      border-radius: 2px;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }
    ${slots}
    @keyframes nvHlSweep { from { background-size: 0% 100%; } to { background-size: 100% 100%; } }
    mark.nv-hl-new { animation: nvHlSweep 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    @media (prefers-reduced-motion: reduce) { mark.nv-hl-new { animation: none; } }
  `;
}

export function readerCss(presentation: ReaderPresentation): string {
  const theme = THEMES[presentation.readTheme];
  const justify = presentation.align === "justify";
  const embedded = `
    blockquote {
      margin-block: 1.3em;
      margin-inline: 0;
      padding-inline-start: 1.15em;
      border-inline-start: 2px solid color-mix(in srgb, ${theme.foreground} 24%, transparent);
      color: color-mix(in srgb, ${theme.foreground} 84%, ${theme.background}) !important;
    }
    blockquote p { text-indent: 0; margin-block: 0.4em; }
    figure { margin-inline: 0; text-align: center; }
    figcaption { font-size: 0.82em; opacity: 0.7; margin-block-start: 0.5em; }
  `;

  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${presentation.readTheme === "dark" ? "dark" : "light"}; font-size: ${presentation.fontSize}px; background: ${theme.background} !important; color: ${theme.foreground} !important; }
    body { background: ${theme.background} !important; color: ${theme.foreground} !important; }
    body :where(p, li, dd, dt, ol, ul, dl, h1, h2, h3, h4, h5, h6, span, em, strong,
      b, i, u, s, small, sub, sup, mark, cite, q, abbr, time, address, div, section,
      article, header, footer, aside, main, nav, table, thead, tbody, tr, td, th,
      caption, figure, figcaption, hr, label) {
      color: inherit !important;
      background-color: transparent !important;
    }
    p, li, dd, dt, blockquote, td, th {
      font-family: ${FONT_STACKS[presentation.font]} !important;
      font-size: ${presentation.fontSize}px !important;
      line-height: ${presentation.lineHeight} !important;
      text-align: ${justify ? "justify" : "start"};
      -webkit-hyphens: ${justify ? "auto" : "manual"};
      hyphens: ${justify ? "auto" : "manual"};
    }
    caption, figcaption {
      font-family: ${FONT_STACKS[presentation.font]} !important;
      line-height: ${presentation.lineHeight} !important;
    }
    p { margin-block: ${presentation.paragraphSpacing}em; }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    [align="justify"] { text-align: justify; }
    ${embedded}
    a:link, a:visited { color: ${theme.foreground} !important; }
    pre { white-space: pre-wrap !important; }
    ${highlightCss(presentation)}
  `;
}
