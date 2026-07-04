import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";

import type { DailyActivity } from "../../lib/types";
import { useLibrary } from "../../store/library";
import styles from "./Insights.module.css";

const DAYS_SHOWN = 30;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local YYYY-MM-DD for a date `daysAgo` days before today. */
function localDayKey(daysAgo: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Jun 12" from a local YYYY-MM-DD key. */
function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Dense 30-day series, zero-filled where nothing was read. */
function fillDays(daily: DailyActivity[]): DailyActivity[] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out: DailyActivity[] = [];
  for (let i = DAYS_SHOWN - 1; i >= 0; i--) {
    const key = localDayKey(i);
    out.push(byDay.get(key) ?? { day: key, activeSeconds: 0, pagesRead: 0, sessions: 0 });
  }
  return out;
}

function fmtDuration(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

function fmtPageTime(seconds: number): string {
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
  return `${seconds}s`;
}

export function Insights() {
  const insights = useLibrary((s) => s.insights);
  const loading = useLibrary((s) => s.insightsLoading);
  const goLibrary = useLibrary((s) => s.goLibrary);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") goLibrary();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goLibrary]);

  const days = insights ? fillDays(insights.daily) : [];
  const peak = Math.max(1, ...days.map((d) => d.activeSeconds));
  const shelfTotal = insights
    ? insights.finishedCount + insights.readingCount + insights.unreadCount
    : 0;
  const hasSignal =
    insights !== null &&
    (insights.sessionCount30d > 0 || insights.bookTimes.length > 0);

  return (
    <div className={styles.content}>
      <div className={styles.inner}>
        <div className={styles.masthead}>
          <div>
            <div className={styles.mastEyebrow}>Your reading</div>
            <h1 className={styles.mastTitle}>Insights</h1>
          </div>
          <button
            type="button"
            className={styles.backBtn}
            onClick={goLibrary}
            title="Back to library (Esc)"
          >
            <ArrowLeft size={14} strokeWidth={2} />
            Library
          </button>
        </div>

        {loading || !insights ? (
          <div className={styles.skeleton} aria-hidden="true">
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonChart} />
            <div className={styles.skeletonRow} />
          </div>
        ) : !hasSignal ? (
          <p className={styles.quietNote}>
            Insights build as you read. Nothing is tracked but time and pages,
            and all of it stays on this machine.
          </p>
        ) : (
          <div className={styles.sections}>
            <section>
              <div className={styles.sectionHead}>
                <span className={styles.sectionLabel}>Last 30 days</span>
                <span className={styles.sectionRule} />
                <span className={styles.sectionNote}>
                  {insights.sessionCount30d}{" "}
                  {insights.sessionCount30d === 1 ? "SESSION" : "SESSIONS"}
                </span>
              </div>

              <div
                className={styles.chart}
                role="img"
                aria-label={`Reading time per day over the last 30 days, ${fmtDuration(insights.activeSeconds30d)} in total`}
              >
                {days.map((d) => (
                  <div
                    key={d.day}
                    className={styles.chartCol}
                    title={
                      d.activeSeconds > 0
                        ? `${dayLabel(d.day)}: ${fmtDuration(d.activeSeconds)}, ${d.pagesRead} pages`
                        : `${dayLabel(d.day)}: no reading`
                    }
                  >
                    <div
                      className={d.activeSeconds > 0 ? styles.bar : styles.barEmpty}
                      style={
                        d.activeSeconds > 0
                          ? { height: `${Math.max(4, (d.activeSeconds / peak) * 100)}%` }
                          : undefined
                      }
                    />
                  </div>
                ))}
              </div>
              <div className={styles.chartAxis} aria-hidden="true">
                <span>{dayLabel(days[0]!.day)}</span>
                <span>today</span>
              </div>

              <div className={styles.statRow}>
                <div className={styles.stat}>
                  <div className={styles.statNum}>
                    {fmtDuration(insights.activeSeconds30d)}
                  </div>
                  <div className={styles.statLbl}>time reading</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statNum}>{insights.pagesRead30d}</div>
                  <div className={styles.statLbl}>pages read</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statNum}>
                    {fmtDuration(insights.avgSessionSeconds30d)}
                  </div>
                  <div className={styles.statLbl}>average session</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statNum}>
                    {insights.streakDays} {insights.streakDays === 1 ? "day" : "days"}
                  </div>
                  <div className={styles.statLbl}>current streak</div>
                </div>
              </div>
            </section>

            {(insights.medianPageSeconds > 0 || insights.pagesPerHour > 0) && (
              <section>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionLabel}>Pace</span>
                  <span className={styles.sectionRule} />
                </div>
                <div className={styles.rows}>
                  {insights.medianPageSeconds > 0 && (
                    <div className={styles.row}>
                      <span className={styles.rowKey}>Median time on a page</span>
                      <span className={styles.rowVal}>
                        {fmtPageTime(insights.medianPageSeconds)}
                      </span>
                    </div>
                  )}
                  {insights.pagesPerHour > 0 && (
                    <div className={styles.row}>
                      <span className={styles.rowKey}>Pages per hour</span>
                      <span className={styles.rowVal}>
                        {Math.round(insights.pagesPerHour)}
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {insights.bookTimes.length > 0 && (
              <section>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionLabel}>Time in books</span>
                  <span className={styles.sectionRule} />
                </div>
                <div className={styles.rows}>
                  {insights.bookTimes.map((b) => (
                    <div key={b.bookId} className={styles.row}>
                      <span className={styles.rowTitle}>
                        {b.title}
                        <span className={styles.rowAuthor}>{b.author}</span>
                      </span>
                      <span className={styles.rowVal}>
                        {fmtDuration(b.activeSeconds)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {insights.finishEstimates.length > 0 && (
              <section>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionLabel}>Left to read</span>
                  <span className={styles.sectionRule} />
                  <span className={styles.sectionNote}>AT YOUR PACE</span>
                </div>
                <div className={styles.rows}>
                  {insights.finishEstimates.slice(0, 6).map((b) => (
                    <div key={b.bookId} className={styles.row}>
                      <span className={styles.rowTitle}>
                        {b.title}
                        <span className={styles.rowAuthor}>
                          {Math.round(b.progress * 100)}% read
                        </span>
                      </span>
                      <span className={styles.rowVal}>
                        about {fmtDuration(b.secondsLeft)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {shelfTotal > 0 && (
              <section>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionLabel}>Shelf</span>
                  <span className={styles.sectionRule} />
                  <span className={styles.sectionNote}>
                    {shelfTotal} {shelfTotal === 1 ? "VOLUME" : "VOLUMES"}
                  </span>
                </div>
                <div
                  className={styles.shelfBar}
                  role="img"
                  aria-label={`${insights.finishedCount} finished, ${insights.readingCount} reading, ${insights.unreadCount} unread`}
                >
                  {insights.finishedCount > 0 && (
                    <span
                      className={styles.segFinished}
                      style={{ flexGrow: insights.finishedCount }}
                    />
                  )}
                  {insights.readingCount > 0 && (
                    <span
                      className={styles.segReading}
                      style={{ flexGrow: insights.readingCount }}
                    />
                  )}
                  {insights.unreadCount > 0 && (
                    <span
                      className={styles.segUnread}
                      style={{ flexGrow: insights.unreadCount }}
                    />
                  )}
                </div>
                <p className={styles.shelfCaption}>
                  {insights.finishedCount} finished · {insights.readingCount}{" "}
                  reading · {insights.unreadCount} unread
                </p>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
