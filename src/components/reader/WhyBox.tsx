import { useEffect, useRef, useState } from "react";

import styles from "./WhyBox.module.css";

interface WhyBoxProps {
  onSave: (note: string) => void;
  onDismiss: () => void;
}

/** Optional, easily-dismissed prompt shown right after a highlight is made. */
export function WhyBox({ onSave, onDismiss }: WhyBoxProps) {
  const [note, setNote] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = () => {
    const trimmed = note.trim();
    if (trimmed) onSave(trimmed);
    else onDismiss();
  };

  return (
    <div className={styles.wrap} role="dialog" aria-label="Add a note to this highlight">
      <input
        ref={ref}
        className={styles.input}
        value={note}
        placeholder="Why this passage?  (optional)"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDismiss();
          }
        }}
        onBlur={commit}
      />
      <button type="button" className={styles.skip} onClick={onDismiss}>
        Skip
      </button>
    </div>
  );
}
