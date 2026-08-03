use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tempfile::Builder;

use crate::db::{now_seconds, Book};
use crate::error::{AppError, AppResult};
use crate::publication::{PublicationArchive, PublicationCover};
use crate::{Db, Storage};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported: Vec<Book>,
    pub skipped: usize,
    pub failed: Vec<ImportFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub path: String,
    pub error: String,
}

pub fn import_paths(storage: &Storage, db: &Db, paths: Vec<String>) -> ImportSummary {
    let mut summary = ImportSummary::default();
    for path in paths {
        match import_one(storage, db, &path) {
            Ok(Some(book)) => summary.imported.push(book),
            Ok(None) => summary.skipped += 1,
            Err(error) => summary.failed.push(ImportFailure {
                path,
                error: error.to_string(),
            }),
        }
    }
    summary
}

fn import_one(storage: &Storage, db: &Db, path: &str) -> AppResult<Option<Book>> {
    let src = Path::new(path);
    let extension = src
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    if extension != "epub" {
        return Err(AppError::Other(format!("unsupported format: .{extension}")));
    }

    let bytes: Arc<[u8]> = Arc::from(std::fs::read(src)?);
    let id = sha256_hex(&bytes);
    if db.book_exists(&id)? {
        return Ok(None);
    }

    let publication = PublicationArchive::parse(bytes.clone())
        .map_err(|error| AppError::Other(error.to_string()))?;
    let metadata = publication.metadata();
    let title = metadata
        .title
        .clone()
        .unwrap_or_else(|| filename_title(src));
    let author = metadata
        .author
        .clone()
        .unwrap_or_else(|| "Unknown".to_string());
    let language = metadata.language.clone();
    let description = metadata.description.clone();
    let cover = publication.load_cover().ok().flatten().map(|cover| {
        let extension = cover_extension(&cover);
        (cover.bytes, extension)
    });

    let shard = &id[0..2];
    let books_sub = storage.books_dir().join(shard);
    std::fs::create_dir_all(&books_sub)?;
    let rel_path = format!("books/{shard}/{id}.{extension}");
    let book_path = storage.resolve_checked(&rel_path)?;
    let staging = Builder::new()
        .prefix(".import-")
        .tempdir_in(storage.root())?;
    let staged_book = staging.path().join("book");
    std::fs::write(&staged_book, bytes.as_ref())?;

    let staged_cover = match cover {
        Some((data, cover_extension)) => {
            let data = crate::cover_image::optimize_imported_cover(data);
            let cover_extension = portable_cover_extension(&cover_extension, &data);
            let rel = format!("covers/{id}.{cover_extension}");
            let staged = staging.path().join("cover");
            std::fs::write(&staged, &data)?;
            Some((rel, staged, data))
        }
        None => None,
    };
    let book_installed = install_staged_file(&staged_book, &book_path, &bytes)?;
    let (cover_path, cover_installed) = match staged_cover {
        Some((rel, staged, data)) => {
            let destination = storage.resolve_checked(&rel)?;
            match install_staged_file(&staged, &destination, &data) {
                Ok(installed) => (Some(rel), installed),
                Err(error) => {
                    if book_installed {
                        let _ = std::fs::remove_file(&book_path);
                    }
                    return Err(error);
                }
            }
        }
        None => (None, false),
    };

    let book = Book {
        id: id.clone(),
        title,
        author,
        format: extension,
        rel_path,
        cover_path,
        page_count: None,
        language,
        description,
        file_size: bytes.len() as i64,
        added_at: now_seconds(),
        progress: 0.0,
        last_read_at: None,
    };
    if let Err(error) = db.insert_book(&book) {
        if book_installed {
            let _ = std::fs::remove_file(&book_path);
        }
        if cover_installed {
            if let Some(path) = &book.cover_path {
                if let Ok(path) = storage.resolve_checked(path) {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
        return Err(error);
    }
    Ok(Some(book))
}

fn install_staged_file(staged: &Path, destination: &Path, expected: &[u8]) -> AppResult<bool> {
    if destination.exists() {
        if std::fs::read(destination)? == expected {
            return Ok(false);
        }
        return Err(AppError::Other(
            "Novus found a conflicting file in its library storage".to_string(),
        ));
    }
    std::fs::rename(staged, destination)?;
    Ok(true)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn filename_title(src: &Path) -> String {
    src.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Untitled")
        .replace(['_', '-'], " ")
}

fn cover_extension(cover: &PublicationCover) -> String {
    Path::new(&cover.href)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase)
        .or_else(|| {
            match cover.media_type.as_str() {
                "image/gif" => Some("gif"),
                "image/jpeg" => Some("jpg"),
                "image/png" => Some("png"),
                "image/webp" => Some("webp"),
                _ => None,
            }
            .map(str::to_owned)
        })
        .unwrap_or_else(|| "img".to_string())
}

fn portable_cover_extension<'a>(extension: &'a str, data: &[u8]) -> &'a str {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if data.starts_with(b"\xff\xd8\xff") {
        "jpg"
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        "gif"
    } else if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        "webp"
    } else if extension.len() <= 12
        && !extension.is_empty()
        && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        extension
    } else {
        "img"
    }
}
