use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppResult;

pub fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: String,
    pub format: String,
    pub rel_path: String,
    pub cover_path: Option<String>,
    pub page_count: Option<i64>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub file_size: i64,
    pub added_at: i64,
    pub progress: f64,
    pub last_read_at: Option<i64>,
}

/// A book's saved reading position.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingState {
    pub locator: Option<String>,
    pub progress: f64,
    pub last_read_at: Option<i64>,
}

/// A user-made collection and the ids of the books it holds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub book_ids: Vec<String>,
}

/// A passage the reader has highlighted in a book.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: String,
    pub book_id: String,
    pub cfi: String,
    pub text: String,
    pub chapter_label: Option<String>,
    pub chapter_href: Option<String>,
    pub section_index: i64,
    pub location: Option<i64>,
    pub color: String,
    pub note: Option<String>,
    pub created_at: i64,
}

/// One local calendar day of reading activity.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyActivity {
    /// Local date, `YYYY-MM-DD`.
    pub day: String,
    pub active_seconds: i64,
    pub pages_read: i64,
    pub sessions: i64,
}

/// Total time a book has actually been read.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookTime {
    pub book_id: String,
    pub title: String,
    pub author: String,
    pub active_seconds: i64,
    pub pages_read: i64,
}

/// Personal-pace estimate of the reading time left in an in-progress book.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishEstimate {
    pub book_id: String,
    pub title: String,
    pub progress: f64,
    pub seconds_left: i64,
}

/// Everything the insights page renders, computed in one pass.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsData {
    pub finished_count: i64,
    pub reading_count: i64,
    pub unread_count: i64,
    pub streak_days: i64,
    pub active_seconds_30d: i64,
    pub pages_read_30d: i64,
    pub session_count_30d: i64,
    pub avg_session_seconds_30d: i64,
    pub median_page_seconds: i64,
    pub pages_per_hour: f64,
    pub daily: Vec<DailyActivity>,
    pub book_times: Vec<BookTime>,
    pub finish_estimates: Vec<FinishEstimate>,
}

/// SQLite-backed library store.
pub struct Db {
    conn: Mutex<Connection>,
}

fn book_from_row(r: &rusqlite::Row) -> rusqlite::Result<Book> {
    Ok(Book {
        id: r.get(0)?,
        title: r.get(1)?,
        author: r.get(2)?,
        format: r.get(3)?,
        rel_path: r.get(4)?,
        cover_path: r.get(5)?,
        page_count: r.get(6)?,
        language: r.get(7)?,
        file_size: r.get(8)?,
        added_at: r.get(9)?,
        progress: r.get(10)?,
        description: r.get(11)?,
        last_read_at: r.get(12)?,
    })
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    /// Idempotent schema migrations keyed off SQLite's `user_version`.
    fn migrate(&self) -> AppResult<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

        if version < 1 {
            conn.execute_batch(
                "CREATE TABLE books (
                    id          TEXT PRIMARY KEY,
                    title       TEXT NOT NULL,
                    author      TEXT NOT NULL,
                    format      TEXT NOT NULL,
                    rel_path    TEXT NOT NULL,
                    cover_path  TEXT,
                    page_count  INTEGER,
                    language    TEXT,
                    file_size   INTEGER NOT NULL,
                    added_at    INTEGER NOT NULL
                 );
                 CREATE TABLE reading_state (
                    book_id           TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                    locator           TEXT,
                    progress          REAL NOT NULL DEFAULT 0,
                    last_read_at      INTEGER
                 );
                 PRAGMA user_version = 1;",
            )?;
        }

        if version < 2 {
            conn.execute_batch(
                "CREATE TABLE collections (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT NOT NULL,
                    created_at  INTEGER NOT NULL
                 );
                 CREATE TABLE collection_books (
                    collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                    book_id        TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    PRIMARY KEY (collection_id, book_id)
                 );
                 CREATE TABLE reading_sessions (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    started_at  INTEGER NOT NULL,
                    ended_at    INTEGER NOT NULL,
                    seconds     INTEGER NOT NULL,
                    pages       INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE INDEX idx_sessions_started ON reading_sessions(started_at);
                 PRAGMA user_version = 2;",
            )?;
        }

        if version < 3 {
            conn.execute_batch(
                "ALTER TABLE books ADD COLUMN description TEXT;
                 PRAGMA user_version = 3;",
            )?;
        }

        if version < 4 {
            conn.execute_batch(
                "CREATE TABLE highlights (
                    id             TEXT PRIMARY KEY,
                    book_id        TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    cfi            TEXT NOT NULL,
                    text           TEXT NOT NULL,
                    chapter_label  TEXT,
                    chapter_href   TEXT,
                    section_index  INTEGER NOT NULL,
                    location       INTEGER,
                    color          TEXT NOT NULL,
                    note           TEXT,
                    created_at     INTEGER NOT NULL
                 );
                 CREATE INDEX idx_highlights_book
                    ON highlights(book_id, section_index, location);
                 PRAGMA user_version = 4;",
            )?;
        }

        if version < 5 {
            conn.execute_batch(
                "ALTER TABLE reading_sessions ADD COLUMN uuid TEXT;
                 ALTER TABLE reading_sessions ADD COLUMN active_seconds INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE reading_sessions ADD COLUMN pages_read INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE reading_sessions ADD COLUMN median_page_ms INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE reading_sessions ADD COLUMN start_fraction REAL NOT NULL DEFAULT 0;
                 ALTER TABLE reading_sessions ADD COLUMN end_fraction REAL NOT NULL DEFAULT 0;
                 CREATE UNIQUE INDEX idx_sessions_uuid ON reading_sessions(uuid);
                 CREATE INDEX idx_sessions_book ON reading_sessions(book_id);
                 PRAGMA user_version = 5;",
            )?;
        }

        Ok(())
    }

    /// All books, newest first, with reading progress joined in.
    pub fn list_books(&self) -> AppResult<Vec<Book>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT b.id, b.title, b.author, b.format, b.rel_path, b.cover_path,
                    b.page_count, b.language, b.file_size, b.added_at,
                    COALESCE(rs.progress, 0), b.description, rs.last_read_at
             FROM books b
             LEFT JOIN reading_state rs ON rs.book_id = b.id
             ORDER BY b.added_at DESC",
        )?;
        let rows = stmt.query_map([], book_from_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn count_books(&self) -> AppResult<i64> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let n = conn.query_row("SELECT COUNT(*) FROM books", [], |r| r.get(0))?;
        Ok(n)
    }

    pub fn book_exists(&self, id: &str) -> AppResult<bool> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let exists = conn
            .query_row("SELECT 1 FROM books WHERE id = ?1", [id], |_| Ok(()))
            .is_ok();
        Ok(exists)
    }

    pub fn insert_book(&self, b: &Book) -> AppResult<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO books
                (id, title, author, format, rel_path, cover_path, page_count, language, file_size, added_at, description)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                b.id, b.title, b.author, b.format, b.rel_path, b.cover_path,
                b.page_count, b.language, b.file_size, b.added_at, b.description,
            ],
        )?;
        Ok(())
    }

    pub fn get_book(&self, id: &str) -> AppResult<Option<Book>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let book = conn
            .query_row(
                "SELECT b.id, b.title, b.author, b.format, b.rel_path, b.cover_path,
                        b.page_count, b.language, b.file_size, b.added_at,
                        COALESCE(rs.progress, 0), b.description, rs.last_read_at
                 FROM books b
                 LEFT JOIN reading_state rs ON rs.book_id = b.id
                 WHERE b.id = ?1",
                [id],
                book_from_row,
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        Ok(book)
    }

    pub fn delete_book(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute("DELETE FROM books WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn get_reading_state(&self, book_id: &str) -> AppResult<Option<ReadingState>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let state = conn
            .query_row(
                "SELECT locator, progress, last_read_at FROM reading_state WHERE book_id = ?1",
                [book_id],
                |r| {
                    Ok(ReadingState {
                        locator: r.get(0)?,
                        progress: r.get(1)?,
                        last_read_at: r.get(2)?,
                    })
                },
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        Ok(state)
    }

    // collections

    pub fn list_collections(&self) -> AppResult<Vec<Collection>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt =
            conn.prepare("SELECT id, name FROM collections ORDER BY name COLLATE NOCASE")?;
        let metas = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        let mut out = Vec::with_capacity(metas.len());
        for (id, name) in metas {
            let mut ms =
                conn.prepare("SELECT book_id FROM collection_books WHERE collection_id = ?1")?;
            let book_ids = ms
                .query_map([id], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            out.push(Collection { id, name, book_ids });
        }
        Ok(out)
    }

    pub fn create_collection(&self, name: &str) -> AppResult<Collection> {
        let now = now_seconds();
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO collections (name, created_at) VALUES (?1, ?2)",
            rusqlite::params![name, now],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Collection {
            id,
            name: name.to_string(),
            book_ids: Vec::new(),
        })
    }

    pub fn delete_collection(&self, id: i64) -> AppResult<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn set_collection_membership(
        &self,
        collection_id: i64,
        book_id: &str,
        member: bool,
    ) -> AppResult<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        if member {
            conn.execute(
                "INSERT OR IGNORE INTO collection_books (collection_id, book_id) VALUES (?1, ?2)",
                rusqlite::params![collection_id, book_id],
            )?;
        } else {
            conn.execute(
                "DELETE FROM collection_books WHERE collection_id = ?1 AND book_id = ?2",
                rusqlite::params![collection_id, book_id],
            )?;
        }
        Ok(())
    }

    // sessions

    /// Upsert one reading session, keyed on a client-generated uuid
    #[allow(clippy::too_many_arguments)]
    pub fn record_session(
        &self,
        uuid: &str,
        book_id: &str,
        started_at: i64,
        ended_at: i64,
        active_seconds: i64,
        pages_read: i64,
        median_page_ms: i64,
        start_fraction: f64,
        end_fraction: f64,
    ) -> AppResult<()> {
        let seconds = (ended_at - started_at).max(0);
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO reading_sessions
                (uuid, book_id, started_at, ended_at, seconds, pages,
                 active_seconds, pages_read, median_page_ms, start_fraction, end_fraction)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6, ?8, ?9, ?10)
             ON CONFLICT(uuid) DO UPDATE SET
                ended_at = excluded.ended_at,
                seconds = excluded.seconds,
                pages = excluded.pages,
                active_seconds = excluded.active_seconds,
                pages_read = excluded.pages_read,
                median_page_ms = excluded.median_page_ms,
                end_fraction = excluded.end_fraction",
            rusqlite::params![
                uuid,
                book_id,
                started_at,
                ended_at,
                seconds,
                pages_read,
                active_seconds,
                median_page_ms,
                start_fraction,
                end_fraction
            ],
        )?;
        Ok(())
    }

    /// Everything the insights page shows.
    pub fn insights_data(&self) -> AppResult<InsightsData> {
        const MIN_RATE_SIGNAL_S: i64 = 600;
        const MIN_RATE_DELTA: f64 = 0.005;

        let conn = self.conn.lock().expect("db mutex poisoned");
        let month_ago = now_seconds() - 30 * 86_400;

        let (finished_count, reading_count, unread_count): (i64, i64, i64) = conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN COALESCE(rs.progress, 0) >= 1 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN COALESCE(rs.progress, 0) > 0
                              AND COALESCE(rs.progress, 0) < 1 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN COALESCE(rs.progress, 0) = 0 THEN 1 ELSE 0 END), 0)
             FROM books b LEFT JOIN reading_state rs ON rs.book_id = b.id",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;

        let streak_days: i64 = conn.query_row(
            "WITH RECURSIVE days(day) AS (
                SELECT DISTINCT date(started_at, 'unixepoch', 'localtime') FROM reading_sessions
             ),
             run(day) AS (
                SELECT CASE
                    WHEN date('now', 'localtime') IN (SELECT day FROM days)
                        THEN date('now', 'localtime')
                    WHEN date('now', 'localtime', '-1 day') IN (SELECT day FROM days)
                        THEN date('now', 'localtime', '-1 day')
                END
                UNION ALL
                SELECT date(day, '-1 day') FROM run
                WHERE date(day, '-1 day') IN (SELECT day FROM days)
             )
             SELECT COUNT(*) FROM run WHERE day IS NOT NULL",
            [],
            |r| r.get(0),
        )?;

        let (active_seconds_30d, pages_read_30d, session_count_30d): (i64, i64, i64) = conn
            .query_row(
                "SELECT
                    COALESCE(SUM(CASE WHEN uuid IS NOT NULL THEN active_seconds ELSE seconds END), 0),
                    COALESCE(SUM(CASE WHEN uuid IS NOT NULL THEN pages_read ELSE pages END), 0),
                    COUNT(*)
                 FROM reading_sessions WHERE started_at >= ?1",
                [month_ago],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
        let avg_session_seconds_30d = if session_count_30d > 0 {
            active_seconds_30d / session_count_30d
        } else {
            0
        };

        let median_page_seconds: i64 = conn.query_row(
            "SELECT COALESCE(SUM(median_page_ms * pages_read) / NULLIF(SUM(pages_read), 0), 0) / 1000
             FROM reading_sessions
             WHERE uuid IS NOT NULL AND pages_read > 0 AND started_at >= ?1",
            [month_ago],
            |r| r.get(0),
        )?;

        let pages_per_hour = if active_seconds_30d > 0 {
            pages_read_30d as f64 * 3600.0 / active_seconds_30d as f64
        } else {
            0.0
        };

        let mut daily_stmt = conn.prepare(
            "SELECT date(started_at, 'unixepoch', 'localtime') AS day,
                    SUM(CASE WHEN uuid IS NOT NULL THEN active_seconds ELSE seconds END),
                    SUM(CASE WHEN uuid IS NOT NULL THEN pages_read ELSE pages END),
                    COUNT(*)
             FROM reading_sessions WHERE started_at >= ?1
             GROUP BY day ORDER BY day ASC",
        )?;
        let daily = daily_stmt
            .query_map([month_ago], |r| {
                Ok(DailyActivity {
                    day: r.get(0)?,
                    active_seconds: r.get(1)?,
                    pages_read: r.get(2)?,
                    sessions: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut times_stmt = conn.prepare(
            "SELECT s.book_id, b.title, b.author,
                    SUM(CASE WHEN s.uuid IS NOT NULL THEN s.active_seconds ELSE s.seconds END) AS t,
                    SUM(CASE WHEN s.uuid IS NOT NULL THEN s.pages_read ELSE s.pages END)
             FROM reading_sessions s JOIN books b ON b.id = s.book_id
             GROUP BY s.book_id ORDER BY t DESC LIMIT 8",
        )?;
        let book_times = times_stmt
            .query_map([], |r| {
                Ok(BookTime {
                    book_id: r.get(0)?,
                    title: r.get(1)?,
                    author: r.get(2)?,
                    active_seconds: r.get(3)?,
                    pages_read: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let (global_delta, global_active): (f64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(MAX(end_fraction - start_fraction, 0)), 0),
                    COALESCE(SUM(active_seconds), 0)
             FROM reading_sessions WHERE uuid IS NOT NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let global_rate = if global_active > 0 {
            global_delta / global_active as f64
        } else {
            0.0
        };

        let mut est_stmt = conn.prepare(
            "SELECT b.id, b.title, rs.progress,
                    COALESCE(SUM(MAX(s.end_fraction - s.start_fraction, 0)), 0),
                    COALESCE(SUM(s.active_seconds), 0)
             FROM books b
             JOIN reading_state rs ON rs.book_id = b.id
                AND rs.progress > 0 AND rs.progress < 1
             LEFT JOIN reading_sessions s ON s.book_id = b.id AND s.uuid IS NOT NULL
             GROUP BY b.id ORDER BY rs.last_read_at DESC",
        )?;
        let finish_estimates = est_stmt
            .query_map([], |r| {
                let book_id: String = r.get(0)?;
                let title: String = r.get(1)?;
                let progress: f64 = r.get(2)?;
                let delta: f64 = r.get(3)?;
                let active: i64 = r.get(4)?;
                Ok((book_id, title, progress, delta, active))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter_map(|(book_id, title, progress, delta, active)| {
                let rate = if active >= MIN_RATE_SIGNAL_S && delta >= MIN_RATE_DELTA {
                    delta / active as f64
                } else {
                    global_rate
                };
                if rate <= 0.0 {
                    return None;
                }
                Some(FinishEstimate {
                    book_id,
                    title,
                    progress,
                    seconds_left: ((1.0 - progress) / rate) as i64,
                })
            })
            .collect();

        Ok(InsightsData {
            finished_count,
            reading_count,
            unread_count,
            streak_days,
            active_seconds_30d,
            pages_read_30d,
            session_count_30d,
            avg_session_seconds_30d,
            median_page_seconds,
            pages_per_hour,
            daily,
            book_times,
            finish_estimates,
        })
    }

    /// Upsert a book's reading position and stamp the time.
    pub fn save_reading_state(
        &self,
        book_id: &str,
        locator: Option<String>,
        progress: f64,
    ) -> AppResult<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO reading_state (book_id, locator, progress, last_read_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(book_id) DO UPDATE SET
                locator = excluded.locator,
                progress = excluded.progress,
                last_read_at = excluded.last_read_at",
            rusqlite::params![book_id, locator, progress, now],
        )?;
        Ok(())
    }

    // highlights

    // all highlights for a book, ordered by their position in the book.
    pub fn list_highlights(&self, book_id: &str) -> AppResult<Vec<Highlight>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, book_id, cfi, text, chapter_label, chapter_href,
                    section_index, location, color, note, created_at
             FROM highlights
             WHERE book_id = ?1
             ORDER BY section_index ASC, location ASC, created_at ASC",
        )?;
        let rows = stmt.query_map([book_id], |r| {
            Ok(Highlight {
                id: r.get(0)?,
                book_id: r.get(1)?,
                cfi: r.get(2)?,
                text: r.get(3)?,
                chapter_label: r.get(4)?,
                chapter_href: r.get(5)?,
                section_index: r.get(6)?,
                location: r.get(7)?,
                color: r.get(8)?,
                note: r.get(9)?,
                created_at: r.get(10)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn add_highlight(&self, h: &Highlight) -> AppResult<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO highlights
                (id, book_id, cfi, text, chapter_label, chapter_href,
                 section_index, location, color, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                h.id, h.book_id, h.cfi, h.text, h.chapter_label, h.chapter_href,
                h.section_index, h.location, h.color, h.note, h.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn set_highlight_color(&self, id: &str, color: &str) -> AppResult<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "UPDATE highlights SET color = ?1 WHERE id = ?2",
            rusqlite::params![color, id],
        )?;
        Ok(())
    }

    /// Set (or clear, with `None`) a highlight's note.
    pub fn set_highlight_note(&self, id: &str, note: Option<String>) -> AppResult<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "UPDATE highlights SET note = ?1 WHERE id = ?2",
            rusqlite::params![note, id],
        )?;
        Ok(())
    }

    pub fn delete_highlight(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute("DELETE FROM highlights WHERE id = ?1", [id])?;
        Ok(())
    }
}
