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

/// Aggregate reading activity for the trailing seven days.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekStats {
    pub streak_days: i64,
    pub seconds: i64,
    pub pages: i64,
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

        Ok(())
    }

    /// All books, newest first, with reading progress joined in.
    pub fn list_books(&self) -> AppResult<Vec<Book>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT b.id, b.title, b.author, b.format, b.rel_path, b.cover_path,
                    b.page_count, b.language, b.file_size, b.added_at,
                    COALESCE(rs.progress, 0), b.description
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
                        COALESCE(rs.progress, 0), b.description
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

    pub fn log_session(
        &self,
        book_id: &str,
        started_at: i64,
        ended_at: i64,
        pages: i64,
    ) -> AppResult<()> {
        let seconds = (ended_at - started_at).max(0);
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO reading_sessions (book_id, started_at, ended_at, seconds, pages)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![book_id, started_at, ended_at, seconds, pages],
        )?;
        Ok(())
    }

    pub fn week_stats(&self) -> AppResult<WeekStats> {
        let now = now_seconds();
        let week_ago = now - 7 * 86_400;
        let conn = self.conn.lock().expect("db mutex poisoned");

        let (seconds, pages): (i64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(seconds), 0), COALESCE(SUM(pages), 0)
             FROM reading_sessions WHERE started_at >= ?1",
            [week_ago],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;

        let mut stmt = conn.prepare(
            "SELECT DISTINCT started_at / 86400 AS day FROM reading_sessions ORDER BY day DESC",
        )?;
        let days = stmt
            .query_map([], |r| r.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        let today = now / 86_400;
        let mut streak = 0;
        let mut expected = today;
        for day in days {
            if day == expected {
                streak += 1;
                expected -= 1;
            } else if day < expected {
                if streak == 0 && day == today - 1 {
                    streak += 1;
                    expected = day - 1;
                } else {
                    break;
                }
            }
        }

        Ok(WeekStats {
            streak_days: streak,
            seconds,
            pages,
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
}
