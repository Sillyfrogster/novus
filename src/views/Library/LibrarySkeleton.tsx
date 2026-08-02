import styles from "./Library.module.css";

const PLACEHOLDER_COVERS = 7;

export function LibrarySkeleton() {
  return (
    <div className={`${styles.layout} ${styles.librarySkeleton}`} role="status" aria-label="Loading library">
      <aside className={styles.skeletonRail} aria-hidden="true">
        <span className={styles.skeletonLabel} />
        <div className={styles.skeletonRecent}>
          <span className={styles.skeletonRecentCover} />
          <span className={styles.skeletonRecentText} />
        </div>
        <span className={styles.skeletonLabel} />
        <span className={styles.skeletonRailLine} />
        <span className={styles.skeletonRailLine} />
        <span className={styles.skeletonRailLine} />
      </aside>
      <div className={styles.shelves} aria-hidden="true">
        <div className={styles.shelvesInner}>
          <div className={styles.skeletonMasthead}>
            <div>
              <span className={styles.skeletonKicker} />
              <span className={styles.skeletonTitle} />
            </div>
            <span className={styles.skeletonControl} />
          </div>
          <div className={styles.skeletonShelfHead}>
            <span className={styles.skeletonShelfTitle} />
            <span className={styles.shelfRule} />
            <span className={styles.skeletonCount} />
          </div>
          <div className={styles.skeletonCoverRow}>
            {Array.from({ length: PLACEHOLDER_COVERS }, (_, index) => (
              <span key={index} className={styles.skeletonCover} />
            ))}
          </div>
          <div className={styles.ledge} />
          <div className={styles.ledgeUnder} />
        </div>
      </div>
    </div>
  );
}
