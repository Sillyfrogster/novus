use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, State};
#[cfg(desktop)]
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

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

/// Save a library copy to a path the user picks in the Rust-side save dialog.
/// Returns None when the user cancels, before the content gate is taken.
#[tauri::command]
pub async fn create_library_backup(
    app: AppHandle,
    state: State<'_, Novus>,
    preferences: serde_json::Value,
) -> AppResult<Option<BackupSummary>> {
    let storage = state.storage.clone();
    let db = state.db.clone();
    let gate = state.content_gate.clone();
    run_blocking(
        "Novus could not finish saving the library copy",
        move || {
            // The extension must match the restore picker's filter, or saved copies are hidden from restore.
            let Some(path) = choose_save_path(
                &app,
                "novus-library-copy.novus-backup",
                "Novus library copy",
                &["novus-backup"],
            )?
            else {
                return Ok(None);
            };
            let _content = write_recovering(&gate);
            create_backup(&storage, &db, &path, &preferences).map(Some)
        },
    )
    .await
}

/// Ask the user where to save, in Rust, so the frontend never supplies a write path.
/// Returns None when the user cancels.
fn choose_save_path(
    app: &AppHandle,
    default_name: &str,
    filter_name: &str,
    extensions: &[&str],
) -> AppResult<Option<PathBuf>> {
    app.dialog()
        .file()
        .set_file_name(default_name)
        .add_filter(filter_name, extensions)
        .blocking_save_file()
        .map(|path| {
            path.into_path().map_err(|error| {
                AppError::Other(format!("Novus could not use that location: {error}"))
            })
        })
        .transpose()
}

/// Suffix of the sibling file an export is written to before it replaces the target.
const EXPORT_TEMP_SUFFIX: &str = ".novus-tmp";

fn export_temp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(EXPORT_TEMP_SUFFIX);
    path.with_file_name(name)
}

fn write_and_sync(temp: &Path, contents: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::File::create(temp)?;
    file.write_all(contents)?;
    file.sync_all()
}

/// Write the bytes to a sibling temp file, then rename it over `path`, so an
/// interrupted export never leaves a truncated file at the chosen path.
fn write_export(path: &Path, contents: &[u8]) -> AppResult<()> {
    let temp = export_temp_path(path);
    let written = write_and_sync(&temp, contents).and_then(|()| std::fs::rename(&temp, path));
    written.map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        AppError::Other(format!("Novus could not save the file: {error}"))
    })
}

/// Save bytes to a path the user picks in the native save dialog.
/// Returns false when the user cancels. Takes no content gate.
#[tauri::command]
#[cfg(desktop)]
pub async fn export_file(
    app: AppHandle,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    contents: Vec<u8>,
) -> AppResult<bool> {
    run_blocking("Novus could not save the file", move || {
        let extension_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        let Some(path) = choose_save_path(&app, &default_name, &filter_name, &extension_refs)?
        else {
            return Ok(false);
        };
        write_export(&path, &contents)?;
        Ok(true)
    })
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

    #[test]
    fn export_writes_exact_bytes_and_leaves_no_temp_file() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("highlight.txt");

        write_export(&target, b"exact bytes").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"exact bytes");
        assert!(!export_temp_path(&target).exists());
    }

    #[test]
    fn export_overwrites_with_identical_bytes_on_repeat() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("highlight.txt");

        write_export(&target, b"same bytes").unwrap();
        write_export(&target, b"same bytes").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"same bytes");
    }

    #[test]
    fn export_failure_leaves_existing_file_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("highlight.txt");
        std::fs::write(&target, b"original").unwrap();
        // A directory where the temp file must go makes the temp write fail.
        std::fs::create_dir(export_temp_path(&target)).unwrap();

        let result = write_export(&target, b"replacement");

        assert!(result.is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
    }
}
