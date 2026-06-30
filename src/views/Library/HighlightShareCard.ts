import { MARK_PATH, MARK_VIEWBOX } from "../../components/Mark";
import type { Book, Highlight } from "../../lib/types";

/**
 * Render a highlight to a branded Novus share image on a canvas.
 */

const W = 1200;
const PAD = 110;
const DPR = 2;

// canvas can't read CSS custom properties (cringe).
const BASE = "#060608";
const INK = "#eef1f6";
const MUTED = "#8d909a";
const FAINT = "#787c86";
const ACCENT = "#cfd8e4";
const LINE = "rgba(255, 255, 255, 0.12)";

const FONT_DISPLAY = '"Bodoni Moda Variable", Georgia, serif';
const FONT_SERIF = '"Lora Variable", Georgia, serif';

async function ensureFonts(passSize: number): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`500 30px ${FONT_DISPLAY}`),
      document.fonts.load(`400 ${passSize}px ${FONT_SERIF}`),
    ]);
    await document.fonts.ready;
  } catch {
    // Fall back to whatever is available.
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderHighlightCard(h: Highlight, book: Book): Promise<Blob> {
  const contentW = W - PAD * 2;
  const len = h.text.length;
  const passSize = len < 140 ? 52 : len < 360 ? 42 : 34;
  const passLH = passSize * 1.42;
  const titleSize = 30;
  const attrSize = 20;

  await ensureFonts(passSize);

  const scratch = document.createElement("canvas").getContext("2d");
  if (!scratch) throw new Error("canvas unavailable");

  scratch.font = `400 ${passSize}px ${FONT_SERIF}`;
  const passLines = wrapText(scratch, `“${h.text}”`, contentW);

  scratch.font = `500 ${titleSize}px ${FONT_DISPLAY}`;
  const titleLines = wrapText(scratch, book.title, contentW);

  const attribution = [
    book.author,
    h.chapterLabel?.trim(),
    h.location != null ? `Location ${h.location + 1}` : null,
  ]
    .filter(Boolean)
    .join("   ·   ");
  scratch.font = `400 ${attrSize}px ${FONT_SERIF}`;
  const attrLines = wrapText(scratch, attribution, contentW);

  const logoH = 34;
  let y = PAD + logoH + 56;
  const titleTop = y;
  y += titleLines.length * (titleSize * 1.2) + 60;
  const passTop = y;
  y += passLines.length * passLH + 52;
  const ruleY = y;
  y += 38;
  const attrTop = y;
  y += attrLines.length * (attrSize * 1.5) + PAD;
  const H = Math.round(y);

  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.scale(DPR, DPR);

  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.1, 0, W * 0.5, H * 0.1, W * 0.85);
  glow.addColorStop(0, "rgba(207, 216, 228, 0.06)");
  glow.addColorStop(1, "rgba(207, 216, 228, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const ms = logoH / MARK_VIEWBOX.height;
  ctx.save();
  ctx.translate(PAD, PAD);
  ctx.scale(ms, ms);
  ctx.fillStyle = ACCENT;
  ctx.fill(new Path2D(MARK_PATH), "evenodd");
  ctx.restore();
  ctx.fillStyle = INK;
  ctx.font = `500 26px ${FONT_DISPLAY}`;
  ctx.textBaseline = "middle";
  ctx.fillText("Novus", PAD + MARK_VIEWBOX.width * ms + 16, PAD + logoH / 2);
  ctx.textBaseline = "alphabetic";

  // Book title.
  ctx.fillStyle = MUTED;
  ctx.font = `500 ${titleSize}px ${FONT_DISPLAY}`;
  titleLines.forEach((line, i) =>
    ctx.fillText(line, PAD, titleTop + i * (titleSize * 1.2) + titleSize),
  );

  // Passage.
  ctx.fillStyle = INK;
  ctx.font = `400 ${passSize}px ${FONT_SERIF}`;
  passLines.forEach((line, i) => ctx.fillText(line, PAD, passTop + i * passLH + passSize));

  // Hairline rule.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, ruleY);
  ctx.lineTo(PAD + 64, ruleY);
  ctx.stroke();

  // Attribution.
  ctx.fillStyle = FAINT;
  ctx.font = `400 ${attrSize}px ${FONT_SERIF}`;
  attrLines.forEach((line, i) => ctx.fillText(line, PAD, attrTop + i * (attrSize * 1.5) + attrSize));

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not render image"))), "image/png"),
  );
}
