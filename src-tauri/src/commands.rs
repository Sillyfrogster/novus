use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[cfg(desktop)]
use tauri::AppHandle;
use tauri::State;
#[cfg(desktop)]
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::backup::{
    cancel_restore, commit_restore, create_backup, finish_restore, prepare_restore,
    request_restore_rollback, restore_status, BackupSummary, RestoreStatus, RestoreSummary,
};
use crate::db::{now_seconds, Book, Collection, Db, Highlight, InsightsData};
use crate::error::{AppError, AppResult};
use crate::import::{import_paths, ImportSummary};
use crate::lock::{read_recovering, write_recovering};
use crate::publication::{ContentsItem, PublicationArchive};
use crate::storage::Storage;
use crate::{Novus, ZoomGuard};

async fn run_blocking<T, F>(failure: &'static str, operation: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| AppError::Other(failure.to_string()))?
}

/// Every book in the library, newest first.
#[tauri::command]
pub fn list_books(state: State<'_, Novus>) -> AppResult<Vec<Book>> {
    state.db.list_books()
}

/// Absolute path of the managed storage root
#[tauri::command]
pub fn storage_root(state: State<'_, Novus>) -> String {
    state.storage.root().to_string_lossy().to_string()
}

#[tauri::command]
pub async fn create_library_backup(
    state: State<'_, Novus>,
    path: String,
    preferences: serde_json::Value,
) -> AppResult<BackupSummary> {
    let storage = state.storage.clone();
    let db = state.db.clone();
    let gate = state.content_gate.clone();
    run_blocking(
        "Novus could not finish saving the library copy",
        move || {
            let _content = write_recovering(&gate);
            create_backup(&storage, &db, Path::new(&path), &preferences)
        },
    )
    .await
}

#[tauri::command]
pub async fn prepare_library_restore(
    state: State<'_, Novus>,
    path: String,
) -> AppResult<RestoreSummary> {
    let storage = state.storage.clone();
    let gate = state.content_gate.clone();
    run_blocking(
        "Novus could not finish checking the library copy",
        move || {
            let _content = write_recovering(&gate);
            prepare_restore(&storage, Path::new(&path))
        },
    )
    .await
}

#[tauri::command]
pub fn commit_library_restore(state: State<'_, Novus>) -> AppResult<()> {
    let _content = write_recovering(&state.content_gate);
    commit_restore(&state.storage)
}

#[tauri::command]
pub async fn cancel_library_restore(state: State<'_, Novus>) -> AppResult<()> {
    let storage = state.storage.clone();
    let gate = state.content_gate.clone();
    run_blocking("Novus could not close the restore safely", move || {
        let _content = write_recovering(&gate);
        cancel_restore(&storage)
    })
    .await
}

#[tauri::command]
pub fn library_restore_status(state: State<'_, Novus>) -> AppResult<Option<RestoreStatus>> {
    let _content = read_recovering(&state.content_gate);
    restore_status(&state.storage)
}

#[tauri::command]
pub async fn finish_library_restore(state: State<'_, Novus>) -> AppResult<()> {
    let storage = state.storage.clone();
    let gate = state.content_gate.clone();
    run_blocking("Novus could not remove the recovery copy", move || {
        let _content = write_recovering(&gate);
        finish_restore(&storage)
    })
    .await
}

#[tauri::command]
pub fn rollback_library_restore(state: State<'_, Novus>) -> AppResult<()> {
    let _content = write_recovering(&state.content_gate);
    request_restore_rollback(&state.storage)
}

/// Import the given file paths into the managed library.
#[tauri::command]
pub async fn import_books(state: State<'_, Novus>, paths: Vec<String>) -> AppResult<ImportSummary> {
    let storage = state.storage.clone();
    let db = state.db.clone();
    let gate = state.content_gate.clone();
    run_blocking("Novus could not finish importing these books", move || {
        let _content = write_recovering(&gate);
        Ok(import_paths(&storage, &db, paths))
    })
    .await
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
pub async fn book_toc(state: State<'_, Novus>, id: String) -> AppResult<Vec<ContentsItem>> {
    let storage = state.storage.clone();
    let db = state.db.clone();
    let gate = state.content_gate.clone();
    run_blocking("Novus could not read this book's contents", move || {
        let _content = read_recovering(&gate);
        let Some(book) = db.get_book(&id)? else {
            return Ok(Vec::new());
        };
        let bytes = std::fs::read(storage.resolve_checked(&book.rel_path)?)?;
        let publication = PublicationArchive::parse(Arc::from(bytes))
            .map_err(|error| AppError::Other(error.to_string()))?;
        Ok(publication.description().contents.clone())
    })
    .await
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

/// Upsert a reading session (uuid-keyed; the reader flushes periodically).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn record_session(
    state: State<'_, Novus>,
    uuid: String,
    book_id: String,
    started_at: i64,
    ended_at: i64,
    active_seconds: i64,
    pages_read: i64,
    median_page_ms: i64,
    start_fraction: f64,
    end_fraction: f64,
) -> AppResult<()> {
    state.db.record_session(
        &uuid,
        &book_id,
        started_at,
        ended_at,
        active_seconds,
        pages_read,
        median_page_ms,
        start_fraction,
        end_fraction,
    )
}

/// Everything the insights page renders.
#[tauri::command]
pub fn insights_data(state: State<'_, Novus>) -> AppResult<InsightsData> {
    state.db.insights_data()
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

// highlights

/// Every highlight for a book, ordered by position.
#[tauri::command]
pub fn list_highlights(state: State<'_, Novus>, book_id: String) -> AppResult<Vec<Highlight>> {
    state.db.list_highlights(&book_id)
}

/// Create a highlight.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn add_highlight(
    state: State<'_, Novus>,
    id: String,
    book_id: String,
    cfi: String,
    text: String,
    chapter_label: Option<String>,
    chapter_href: Option<String>,
    section_index: i64,
    location: Option<i64>,
    color: String,
    note: Option<String>,
) -> AppResult<Highlight> {
    let highlight = Highlight {
        id,
        book_id,
        cfi,
        text,
        chapter_label,
        chapter_href,
        section_index,
        location,
        color,
        note,
        created_at: now_seconds(),
    };
    state.db.add_highlight(&highlight)?;
    Ok(highlight)
}

/// Set or clear (with `null`) a highlight's note.
#[tauri::command]
pub fn set_highlight_note(
    state: State<'_, Novus>,
    id: String,
    note: Option<String>,
) -> AppResult<()> {
    state.db.set_highlight_note(&id, note)
}

#[tauri::command]
pub fn delete_highlight(state: State<'_, Novus>, id: String) -> AppResult<()> {
    state.db.delete_highlight(&id)
}

/// Write bytes to a user-chosen path.
#[tauri::command]
#[cfg(desktop)]
pub async fn write_file(path: String, contents: Vec<u8>) -> AppResult<()> {
    run_blocking("Novus could not save the file", move || {
        std::fs::write(&path, &contents).map_err(Into::into)
    })
    .await
}

#[tauri::command]
#[cfg(desktop)]
pub async fn copy_highlight_image(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> AppResult<()> {
    const MAX_PIXELS: u32 = 16_000_000;

    let dimension = |name: &'static str| -> AppResult<u32> {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| AppError::Other(format!("invalid {name} header")))
    };
    let width = dimension("novus-image-width")?;
    let height = dimension("novus-image-height")?;
    let pixel_count = width
        .checked_mul(height)
        .filter(|count| *count <= MAX_PIXELS)
        .ok_or_else(|| AppError::Other("highlight image is too large".to_string()))?;
    let expected_bytes = pixel_count as usize * 4;
    let rgba = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.len() == expected_bytes => bytes.clone(),
        tauri::ipc::InvokeBody::Raw(_) => {
            return Err(AppError::Other(
                "highlight image dimensions do not match its pixel data".to_string(),
            ));
        }
        _ => {
            return Err(AppError::Other(
                "highlight image must use binary transfer".to_string(),
            ));
        }
    };

    run_blocking("Novus could not copy the highlight image", move || {
        let image = tauri::image::Image::new_owned(rgba, width, height);
        app.clipboard()
            .write_image(&image)
            .map_err(|error| AppError::Other(error.to_string()))
    })
    .await
}

/// Remove a book from the library, deleting its managed file and cover.
#[tauri::command]
pub async fn remove_book(state: State<'_, Novus>, id: String) -> AppResult<()> {
    let storage = state.storage.clone();
    let db = state.db.clone();
    let gate = state.content_gate.clone();
    run_blocking("Novus could not remove this book", move || {
        let _content = write_recovering(&gate);
        remove_book_files(&storage, &db, &id)
    })
    .await
}

/// Delete the book row, then best-effort remove its managed file and cover.
/// Ignores file removal errors, so the row goes even if the file stays.
fn remove_book_files(storage: &Storage, db: &Db, id: &str) -> AppResult<()> {
    let book = db.get_book(id)?;
    db.delete_book(id)?;
    if let Some(book) = book {
        if let Ok(path) = storage.resolve_checked(&book.rel_path) {
            let _ = std::fs::remove_file(path);
        }
        if let Some(cover) = &book.cover_path {
            if let Ok(path) = storage.resolve_checked(cover) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A library with one book row whose managed file path is books/book-1.epub.
    fn library_with_one_book() -> (tempfile::TempDir, Storage, Db) {
        let temp = tempfile::tempdir().unwrap();
        let storage = Storage::for_test(temp.path().join("library")).unwrap();
        let db = Db::open(&storage.db_path(), || Ok(())).unwrap();
        db.insert_book(&Book {
            id: "book-1".to_string(),
            title: "Title".to_string(),
            author: "Author".to_string(),
            format: "epub".to_string(),
            rel_path: "books/book-1.epub".to_string(),
            cover_path: None,
            page_count: None,
            language: None,
            description: None,
            file_size: 4,
            added_at: 1,
            progress: 0.0,
            last_read_at: None,
        })
        .unwrap();
        (temp, storage, db)
    }

    #[test]
    fn behavior_remove_book_deletes_row_and_file() {
        let (_temp, storage, db) = library_with_one_book();
        let file = storage.resolve_checked("books/book-1.epub").unwrap();
        std::fs::write(&file, b"book").unwrap();

        remove_book_files(&storage, &db, "book-1").unwrap();

        assert!(db.get_book("book-1").unwrap().is_none());
        assert!(!file.exists());
    }

    // Flip these assertions once file removal failures are reported.
    #[test]
    fn behavior_remove_book_file_failure_pins_data_07() {
        let (_temp, storage, db) = library_with_one_book();
        let path = storage.resolve_checked("books/book-1.epub").unwrap();
        std::fs::create_dir(&path).unwrap();

        let result = remove_book_files(&storage, &db, "book-1");

        assert!(result.is_ok());
        assert!(db.get_book("book-1").unwrap().is_none());
        assert!(path.is_dir());
    }
}
