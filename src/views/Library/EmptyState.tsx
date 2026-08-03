import { Plus } from "lucide-react";

import { Mark } from "../../components/Mark";
import { isDesktop } from "../../lib/platform";
import styles from "./Library.module.css";

interface EmptyStateProps {
  onAddBooks: () => void;
  busy: boolean;
}

/** prompt import */
export function EmptyState({ onAddBooks, busy }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyGlow}>
        <Mark size={56} />
      </div>
      <div className={styles.eyebrow}>Novus</div>
      <h1 className={styles.title}>An empty shelf</h1>
      <p className={styles.subtitle}>
        {isDesktop
          ? "Bring your books into Novus and they become yours to keep — copied into your library, safe from a moved or deleted file. Start with a few EPUBs."
          : "Your shelf is ready. Mobile book import will arrive with Novus mobile support."}
      </p>
      {isDesktop && (
        <>
          <button type="button" className={styles.cta} onClick={onAddBooks} disabled={busy}>
            <Plus size={15} strokeWidth={1.9} />
            {busy ? "Importing…" : "Add books"}
          </button>
          <div className={styles.hint}>or drop EPUB files anywhere</div>
        </>
      )}
    </div>
  );
}
