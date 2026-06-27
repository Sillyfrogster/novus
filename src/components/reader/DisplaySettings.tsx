import { X } from "lucide-react";

import { FONT_LABELS, useReaderSettings } from "../../store/reader";
import type { ReadFont, ReadLayout, ReadTheme, TextAlign } from "../../lib/types";
import styles from "./DisplaySettings.module.css";

interface DisplaySettingsProps {
  onClose: () => void;
}

const THEMES: { key: ReadTheme; label: string; bg: string; fg: string }[] = [
  { key: "light", label: "Light", bg: "#f4f5f7", fg: "#1b1d23" },
  { key: "sepia", label: "Sepia", bg: "#ece1cf", fg: "#433a2b" },
  { key: "dark", label: "Dark", bg: "#0c0d10", fg: "#c9ccd4" },
];

const FONTS: ReadFont[] = ["serif", "sans", "modern"];
const ALIGNS: { key: TextAlign; label: string }[] = [
  { key: "left", label: "Left" },
  { key: "justify", label: "Justified" },
];
const LAYOUTS: { key: ReadLayout; label: string }[] = [
  { key: "paged", label: "Paged" },
  { key: "scroll", label: "Scroll" },
];

export function DisplaySettings({ onClose }: DisplaySettingsProps) {
  const s = useReaderSettings();

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.head}>
          <span className={styles.title}>Display</span>
          <button type="button" className={styles.close} onClick={onClose} title="Close">
            <X size={14} strokeWidth={1.4} />
          </button>
        </div>

        <div className={styles.body}>
          <section>
            <div className={styles.label}>Theme</div>
            <div className={styles.themes}>
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`${styles.theme} ${s.readTheme === t.key ? styles.active : ""}`}
                  onClick={() => s.set("readTheme", t.key)}
                >
                  <span className={styles.swatch} style={{ background: t.bg, color: t.fg }}>
                    A
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className={styles.label}>Typeface</div>
            <div className={styles.seg}>
              {FONTS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`${styles.segBtn} ${s.font === f ? styles.active : ""}`}
                  onClick={() => s.set("font", f)}
                >
                  {FONT_LABELS[f]}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className={styles.rowLabel}>
              <span className={styles.label} style={{ marginBottom: 0 }}>
                Font size
              </span>
              <span className={styles.value}>{s.fontSize} px</span>
            </div>
            <div className={styles.sliderRow}>
              <span className={styles.glyphSm}>A</span>
              <input
                type="range"
                min={15}
                max={26}
                step={1}
                value={s.fontSize}
                onChange={(e) => s.set("fontSize", Number(e.target.value))}
                className={styles.slider}
              />
              <span className={styles.glyphLg}>A</span>
            </div>
          </section>

          <section>
            <div className={styles.rowLabel}>
              <span className={styles.label} style={{ marginBottom: 0 }}>
                Line spacing
              </span>
              <span className={styles.value}>{s.lineHeight.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={1.3}
              max={2.2}
              step={0.05}
              value={s.lineHeight}
              onChange={(e) => s.set("lineHeight", Number(e.target.value))}
              className={styles.slider}
            />
          </section>

          <section>
            <div className={styles.rowLabel}>
              <span className={styles.label} style={{ marginBottom: 0 }}>
                Paragraph spacing
              </span>
              <span className={styles.value}>{s.paragraphSpacing.toFixed(2)} em</span>
            </div>
            <input
              type="range"
              min={0}
              max={1.4}
              step={0.05}
              value={s.paragraphSpacing}
              onChange={(e) => s.set("paragraphSpacing", Number(e.target.value))}
              className={styles.slider}
            />
          </section>

          <section>
            <div className={styles.label}>Alignment</div>
            <div className={styles.seg}>
              {ALIGNS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className={`${styles.segBtn} ${s.align === a.key ? styles.active : ""}`}
                  onClick={() => s.set("align", a.key)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className={styles.label}>Layout</div>
            <div className={styles.seg}>
              {LAYOUTS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className={`${styles.segBtn} ${s.layout === l.key ? styles.active : ""}`}
                  onClick={() => s.set("layout", l.key)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className={styles.rowLabel}>
              <span className={styles.label} style={{ marginBottom: 0 }}>
                Brightness
              </span>
              <span className={styles.value}>{Math.round(s.brightness * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.45}
              max={1}
              step={0.05}
              value={s.brightness}
              onChange={(e) => s.set("brightness", Number(e.target.value))}
              className={styles.slider}
            />
          </section>
        </div>
      </div>
    </>
  );
}
