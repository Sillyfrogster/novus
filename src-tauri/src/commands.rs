use std::sync::atomic::Ordering;

use tauri::State;

use crate::db::{Book, Collection, ReadingState, WeekStats};
use crate::error::AppResult;
use crate::import::{import_paths, read_epub_toc, ImportSummary, TocEntry};
use crate::{Novus, ZoomGuard};

/// Every book in the library, newest first.
#[tauri::command]
pub fn list_books(state: State<'_, Novus>) -> AppResult<Vec<Book>> {
    state.db.list_books()
}

/// Number of volumes in the library (used by the rail/profile).
#[tauri::command]
pub fn library_count(state: State<'_, Novus>) -> AppResult<i64> {
    state.db.count_books()
}

/// Absolute path of the managed storage root
#[tauri::command]
pub fn storage_root(state: State<'_, Novus>) -> String {
    state.storage.root().to_string_lossy().to_string()
}

/// Import the given file paths into the managed library.
#[tauri::command]
pub fn import_books(state: State<'_, Novus>, paths: Vec<String>) -> AppResult<ImportSummary> {
    Ok(import_paths(&state, paths))
}

/// A book's saved reading position, if any.
#[tauri::command]
pub fn get_reading_state(state: State<'_, Novus>, id: String) -> AppResult<Option<ReadingState>> {
    state.db.get_reading_state(&id)
}

/// Persist a book's reading position and progress.
#[tauri::command]
pub fn save_reading_state(
    state: State<'_, Novus>,
    id: String,
    locator: Option<String>,
    progress: f64,
) -> AppResult<()> {
    state.db.save_reading_state(&id, locator, progress)
}

#[tauri::command]
pub fn book_toc(state: State<'_, Novus>, id: String) -> AppResult<Vec<TocEntry>> {
    let Some(book) = state.db.get_book(&id)? else {
        return Ok(Vec::new());
    };
    let bytes = std::fs::read(state.storage.resolve(&book.rel_path))?;
    Ok(read_epub_toc(&bytes))
}

// collections

#[tauri::command]
pub fn list_collections(state: State<'_, Novus>) -> AppResult<Vec<Collection>> {
    state.db.list_collections()
}

#[tauri::command]
pub fn create_collection(state: State<'_, Novus>, name: String) -> AppResult<Collection> {
    state.db.create_collection(name.trim())
}

#[tauri::command]
pub fn delete_collection(state: State<'_, Novus>, id: i64) -> AppResult<()> {
    state.db.delete_collection(id)
}

#[tauri::command]
pub fn set_collection_membership(
    state: State<'_, Novus>,
    collection_id: i64,
    book_id: String,
    member: bool,
) -> AppResult<()> {
    state
        .db
        .set_collection_membership(collection_id, &book_id, member)
}

// Reading sessions

#[tauri::command]
pub fn log_session(
    state: State<'_, Novus>,
    book_id: String,
    started_at: i64,
    ended_at: i64,
    pages: i64,
) -> AppResult<()> {
    state.db.log_session(&book_id, started_at, ended_at, pages)
}

#[tauri::command]
pub fn week_stats(state: State<'_, Novus>) -> AppResult<WeekStats> {
    state.db.week_stats()
}

/// Lock or unlock page zoom. The reader unlocks it; everywhere else stays locked
#[tauri::command]
#[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
pub fn set_zoom_locked(locked: bool, window: tauri::WebviewWindow, guard: State<'_, ZoomGuard>) {
    guard.0.store(locked, Ordering::Relaxed);
    #[cfg(target_os = "linux")]
    if locked {
        let _ = window.with_webview(|webview| {
            use webkit2gtk::WebViewExt;
            webview.inner().set_zoom_level(1.0);
        });
    }
}

/// Remove a book from the library, deleting its managed file and cover.
#[tauri::command]
pub fn remove_book(state: State<'_, Novus>, id: String) -> AppResult<()> {
    if let Some(book) = state.db.get_book(&id)? {
        let _ = std::fs::remove_file(state.storage.resolve(&book.rel_path));
        if let Some(cover) = &book.cover_path {
            let _ = std::fs::remove_file(state.storage.resolve(cover));
        }
    }
    state.db.delete_book(&id)
}
