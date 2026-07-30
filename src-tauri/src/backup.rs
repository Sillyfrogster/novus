use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::{Builder, NamedTempFile};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::db::{now_seconds, Db};
use crate::error::{AppError, AppResult};
use crate::storage::Storage;

const BACKUP_FORMAT: &str = "novus-library";
const BACKUP_VERSION: u32 = 1;
const MANIFEST_PATH: &str = "manifest.json";
const DATABASE_PATH: &str = "novus.db";
const PREFERENCES_PATH: &str = "preferences.json";
const RESTORE_DIR: &str = ".restore-transaction";
const RESTORE_JOURNAL: &str = "journal.json";
const PREVIOUS_DIR: &str = "previous";
const INCOMING_DIR: &str = "incoming";
const BACKUP_WORK_PREFIX: &str = ".backup-";
const RESTORE_PREPARING_PREFIX: &str = ".restore-preparing-";
const DISCARD_PREFIX: &str = ".restore-discard-";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_PREFERENCES_BYTES: usize = 256 * 1024;
const MAX_ARCHIVE_FILES: usize = 200_002;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024 * 1024;
const RESTORE_SPACE_RESERVE: u64 = 128 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    format: String,
    version: u32,
    app_version: String,
    database_version: i64,
    created_at: i64,
    book_count: usize,
    files: Vec<BackupFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub created_at: i64,
    pub book_count: usize,
    pub file_count: usize,
    pub byte_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub backup_created_at: i64,
    pub book_count: usize,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPreferences {
    pub app_theme: String,
    pub profile_name: String,
    pub reader_settings: serde_json::Value,
    pub highlight_colors: serde_json::Value,
    pub continue_shelf_open: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreStatus {
    pub state: String,
    pub backup_created_at: i64,
    pub book_count: usize,
    pub file_count: usize,
    pub preferences: LibraryPreferences,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreJournal {
    version: u32,
    state: String,
    step: u8,
    backup_created_at: i64,
    book_count: usize,
    file_count: usize,
    preferences: LibraryPreferences,
    error: Option<String>,
}

struct SourceFile {
    archive_path: String,
    source_path: PathBuf,
    expected_size: Option<u64>,
    expected_sha256: Option<String>,
}

fn validate_backup_destination(storage: &Storage, destination: &Path) -> AppResult<()> {
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = std::fs::canonicalize(parent).map_err(|_| {
        backup_error("Novus could not use that destination. Choose an existing folder.")
    })?;
    let storage_root = std::fs::canonicalize(storage.root())?;
    if parent.starts_with(storage_root) {
        return Err(backup_error(
            "Choose a location outside Novus's library storage.",
        ));
    }
    Ok(())
}

pub fn create_backup(
    storage: &Storage,
    db: &Db,
    destination: &Path,
    preferences: &LibraryPreferences,
) -> AppResult<BackupSummary> {
    validate_backup_destination(storage, destination)?;
    validate_preferences(preferences)?;
    let work = Builder::new()
        .prefix(BACKUP_WORK_PREFIX)
        .tempdir_in(storage.root())?;
    let database = work.path().join(DATABASE_PATH);
    db.backup_to(&database)?;
    let database_version = Db::validate_file(&database)?;
    let preferences_path = work.path().join(PREFERENCES_PATH);
    std::fs::write(
        &preferences_path,
        serde_json::to_vec(preferences)
            .map_err(|error| backup_error(format!("Could not save preferences: {error}")))?,
    )?;

    let mut sources = vec![
        SourceFile {
            archive_path: DATABASE_PATH.to_string(),
            source_path: database.clone(),
            expected_size: None,
            expected_sha256: None,
        },
        SourceFile {
            archive_path: PREFERENCES_PATH.to_string(),
            source_path: preferences_path,
            expected_size: None,
            expected_sha256: None,
        },
    ];
    let book_count = collect_referenced_files(storage, &database, &mut sources)?;
    sources.sort_by(|a, b| a.archive_path.cmp(&b.archive_path));

    let mut files = Vec::with_capacity(sources.len());
    for source in &sources {
        let (size, sha256) = hash_file(&source.source_path)?;
        if source
            .expected_size
            .is_some_and(|expected| expected != size)
        {
            return Err(backup_error(format!(
                "The stored size is wrong for {}",
                source.archive_path
            )));
        }
        if source
            .expected_sha256
            .as_ref()
            .is_some_and(|expected| expected != &sha256)
        {
            return Err(backup_error(format!(
                "The stored content is wrong for {}",
                source.archive_path
            )));
        }
        files.push(BackupFile {
            path: source.archive_path.clone(),
            size,
            sha256,
        });
    }

    let manifest = BackupManifest {
        format: BACKUP_FORMAT.to_string(),
        version: BACKUP_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        database_version,
        created_at: now_seconds(),
        book_count,
        files,
    };
    let manifest_bytes = serde_json::to_vec(&manifest)
        .map_err(|error| backup_error(format!("Could not prepare the manifest: {error}")))?;

    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty());
    let mut output = match parent {
        Some(parent) => NamedTempFile::new_in(parent)?,
        None => NamedTempFile::new_in(".")?,
    };

    {
        let mut archive = ZipWriter::new(output.as_file_mut());
        let text_options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o600);
        archive
            .start_file(MANIFEST_PATH, text_options)
            .map_err(backup_archive_error)?;
        archive.write_all(&manifest_bytes)?;

        for source in &sources {
            let options = SimpleFileOptions::default()
                .compression_method(compression_for(&source.source_path))
                .unix_permissions(0o600);
            archive
                .start_file(&source.archive_path, options)
                .map_err(backup_archive_error)?;
            let mut input = BufReader::new(File::open(&source.source_path)?);
            std::io::copy(&mut input, &mut archive)?;
        }

        archive.finish().map_err(backup_archive_error)?;
    }

    output.as_file().sync_all()?;
    output
        .persist(destination)
        .map_err(|error| AppError::Io(error.error))?;
    if let Some(parent) = destination.parent() {
        sync_directory(parent)?;
    }

    Ok(BackupSummary {
        created_at: manifest.created_at,
        book_count: manifest.book_count,
        file_count: manifest.files.len(),
        byte_count: manifest.files.iter().map(|file| file.size).sum(),
    })
}

pub fn prepare_restore(storage: &Storage, source: &Path) -> AppResult<RestoreSummary> {
    let transaction = storage.root().join(RESTORE_DIR);
    if transaction.exists() {
        return Err(AppError::Other(
            "Finish or cancel the current restore before choosing another backup".to_string(),
        ));
    }

    let work = Builder::new()
        .prefix(RESTORE_PREPARING_PREFIX)
        .tempdir_in(storage.root())?;
    let incoming = work.path().join(INCOMING_DIR);
    std::fs::create_dir_all(&incoming)?;
    let manifest = extract_and_validate(source, &incoming)?;
    let preferences = read_preferences(&incoming.join(PREFERENCES_PATH))?;
    let journal = RestoreJournal {
        version: 1,
        state: "prepared".to_string(),
        step: 0,
        backup_created_at: manifest.created_at,
        book_count: manifest.book_count,
        file_count: manifest.files.len(),
        preferences,
        error: None,
    };
    write_journal(work.path(), &journal)?;

    let prepared = work.keep();
    if let Err(error) = rename_durable(&prepared, &transaction) {
        let _ = std::fs::remove_dir_all(&prepared);
        return Err(error);
    }

    Ok(RestoreSummary {
        backup_created_at: manifest.created_at,
        book_count: manifest.book_count,
        file_count: manifest.files.len(),
    })
}

pub fn commit_restore(storage: &Storage) -> AppResult<()> {
    let transaction = storage.root().join(RESTORE_DIR);
    let mut journal = read_journal(&transaction)?;
    if journal.state != "prepared" {
        return Err(AppError::Other(
            "This restore is not ready to install".to_string(),
        ));
    }
    journal.state = "install".to_string();
    journal.error = None;
    write_journal(&transaction, &journal)
}

pub fn cancel_restore(storage: &Storage) -> AppResult<()> {
    let transaction = storage.root().join(RESTORE_DIR);
    if !transaction.exists() {
        return Ok(());
    }
    let journal = read_journal(&transaction)?;
    if journal.state != "prepared" && journal.state != "failed" {
        return Err(AppError::Other(
            "The restored library is already being installed".to_string(),
        ));
    }
    discard_transaction(storage, &transaction)
}

pub fn restore_status(storage: &Storage) -> AppResult<Option<RestoreStatus>> {
    let transaction = storage.root().join(RESTORE_DIR);
    if !transaction.exists() {
        return Ok(None);
    }
    let journal = read_journal(&transaction)?;
    Ok(Some(status_from_journal(journal)))
}

pub fn finish_restore(storage: &Storage) -> AppResult<()> {
    let transaction = storage.root().join(RESTORE_DIR);
    if !transaction.exists() {
        return Ok(());
    }
    let journal = read_journal(&transaction)?;
    if journal.state != "installed" {
        return Err(AppError::Other(
            "The restored library has not finished installing".to_string(),
        ));
    }
    discard_transaction(storage, &transaction)
}

pub fn request_restore_rollback(storage: &Storage) -> AppResult<()> {
    let transaction = storage.root().join(RESTORE_DIR);
    let mut journal = read_journal(&transaction)?;
    if journal.state != "installed" {
        return Err(AppError::Other(
            "This restored library cannot be rolled back".to_string(),
        ));
    }
    journal.state = "rollingBack".to_string();
    journal.error = Some(
        "Novus returned to your previous library because the restored copy could not open."
            .to_string(),
    );
    write_journal(&transaction, &journal)
}

pub fn recover_interrupted_restore(storage: &Storage) -> AppResult<()> {
    let transaction = storage.root().join(RESTORE_DIR);
    if !transaction.exists() {
        return Ok(());
    }
    if !transaction.join(RESTORE_JOURNAL).is_file() {
        if Db::validate_file(&storage.db_path()).is_ok()
            && validate_installed_files(storage).is_ok()
        {
            return discard_transaction(storage, &transaction);
        }
        return Err(AppError::Other(
            "Novus found an incomplete recovery copy and could not verify the library".to_string(),
        ));
    }

    let mut journal = read_journal(&transaction)?;
    if journal.state == "rollingBack" {
        return rollback_startup_restore(storage, &transaction, &mut journal);
    }
    if journal.state == "installed" {
        journal.state = "rollingBack".to_string();
        journal.error = Some(
            "Novus returned to your previous library because the restored copy did not finish opening."
                .to_string(),
        );
        write_journal(&transaction, &journal)?;
        return rollback_startup_restore(storage, &transaction, &mut journal);
    }
    if journal.state == "install" || journal.state == "installing" {
        journal.state = "installing".to_string();
        write_journal(&transaction, &journal)?;
        if install_prepared_restore(storage, &transaction, &mut journal).is_err() {
            journal.state = "rollingBack".to_string();
            journal.error = Some(
                "Novus kept your previous library because the restored copy could not be verified."
                    .to_string(),
            );
            write_journal(&transaction, &journal)?;
            rollback_startup_restore(storage, &transaction, &mut journal)?;
        }
    }
    Ok(())
}

pub fn cleanup_stale_work(storage: &Storage) {
    let Ok(entries) = std::fs::read_dir(storage.root()) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_str().is_some_and(|name| {
            name.starts_with(BACKUP_WORK_PREFIX)
                || name.starts_with(RESTORE_PREPARING_PREFIX)
                || name.starts_with(DISCARD_PREFIX)
        }) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn extract_and_validate(source: &Path, destination: &Path) -> AppResult<BackupManifest> {
    let input = File::open(source)?;
    let mut archive = ZipArchive::new(BufReader::new(input)).map_err(restore_archive_error)?;
    let manifest = read_manifest(&mut archive)?;
    validate_manifest(&manifest)?;
    ensure_restore_space(destination, &manifest)?;
    if archive.len() != manifest.files.len() + 1 {
        return Err(invalid_backup(
            "The archive contents do not match its manifest",
        ));
    }

    let mut archive_paths = BTreeSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(restore_archive_error)?;
        let name = entry.name().to_string();
        if !archive_paths.insert(name.clone()) {
            return Err(invalid_backup(format!("Duplicate entry: {name}")));
        }
        if entry.enclosed_name().is_none() {
            return Err(invalid_backup(format!("Unsafe entry path: {name}")));
        }
        if entry.is_symlink() {
            return Err(invalid_backup(format!(
                "Symbolic links are not allowed: {name}"
            )));
        }
    }

    let expected_paths: BTreeSet<_> = manifest
        .files
        .iter()
        .map(|file| file.path.as_str())
        .chain(std::iter::once(MANIFEST_PATH))
        .collect();
    let actual_paths: BTreeSet<_> = archive_paths.iter().map(String::as_str).collect();
    if actual_paths != expected_paths {
        return Err(invalid_backup(
            "The archive contents do not match its manifest",
        ));
    }

    for expected in &manifest.files {
        validate_archive_path(&expected.path)?;
        let mut entry = archive
            .by_name(&expected.path)
            .map_err(restore_archive_error)?;
        if entry.is_dir() {
            return Err(invalid_backup(format!(
                "Expected a file at {}",
                expected.path
            )));
        }
        if entry.size() != expected.size {
            return Err(invalid_backup(format!(
                "The stored size is wrong for {}",
                expected.path
            )));
        }

        let output_path = destination.join(path_from_archive(&expected.path)?);
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let output = File::create(&output_path)?;
        let mut writer = BufWriter::new(output);
        let mut hasher = Sha256::new();
        let mut size = 0_u64;
        let mut buffer = [0_u8; 128 * 1024];
        loop {
            let read = entry.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            writer.write_all(&buffer[..read])?;
            hasher.update(&buffer[..read]);
            size += read as u64;
        }
        writer.flush()?;
        writer.get_ref().sync_all()?;

        let sha256 = digest_hex(hasher.finalize());
        if size != expected.size || sha256 != expected.sha256 {
            return Err(invalid_backup(format!(
                "File verification failed for {}",
                expected.path
            )));
        }
    }

    let database = destination.join(DATABASE_PATH);
    let database_version = Db::validate_file(&database)?;
    if database_version != manifest.database_version {
        return Err(invalid_backup(
            "The database version does not match the backup manifest",
        ));
    }
    validate_database_files(&database, &manifest)?;
    let staged_db = Db::open(&database, || Ok(()))?;
    let clean_database = destination.join("novus.clean.db");
    staged_db.backup_to(&clean_database)?;
    drop(staged_db);
    remove_if_present(&database)?;
    remove_if_present(&destination.join("novus.db-wal"))?;
    remove_if_present(&destination.join("novus.db-shm"))?;
    rename_durable(&clean_database, &database)?;
    Db::validate_file(&database)?;
    std::fs::create_dir_all(destination.join("books"))?;
    std::fs::create_dir_all(destination.join("covers"))?;
    Ok(manifest)
}

fn read_manifest<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> AppResult<BackupManifest> {
    let mut entry = archive
        .by_name(MANIFEST_PATH)
        .map_err(|_| invalid_backup("The archive does not contain a Novus backup manifest"))?;
    if entry.size() > MAX_MANIFEST_BYTES {
        return Err(invalid_backup("The backup manifest is too large"));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes)?;
    serde_json::from_slice(&bytes).map_err(|_| invalid_backup("The backup manifest is invalid"))
}

fn validate_manifest(manifest: &BackupManifest) -> AppResult<()> {
    if manifest.format != BACKUP_FORMAT {
        return Err(invalid_backup("This is not a Novus library backup"));
    }
    if manifest.version != BACKUP_VERSION {
        return Err(invalid_backup(format!(
            "Backup version {} is not supported",
            manifest.version
        )));
    }
    if !(946_684_800..=4_102_444_800).contains(&manifest.created_at) {
        return Err(invalid_backup("The backup date is invalid"));
    }
    if manifest.files.is_empty() {
        return Err(invalid_backup("The backup contains no library files"));
    }
    if manifest.files.len() > MAX_ARCHIVE_FILES {
        return Err(invalid_backup("The backup contains too many files"));
    }
    if manifest.book_count > manifest.files.len() {
        return Err(invalid_backup("The backup contains an invalid book count"));
    }

    let mut paths = BTreeSet::new();
    let mut total_size = 0_u64;
    for file in &manifest.files {
        validate_archive_path(&file.path)?;
        if !paths.insert(&file.path) {
            return Err(invalid_backup(format!(
                "Duplicate manifest entry: {}",
                file.path
            )));
        }
        if file.size > MAX_FILE_BYTES {
            return Err(invalid_backup(format!(
                "A file is too large to restore: {}",
                file.path
            )));
        }
        total_size = total_size
            .checked_add(file.size)
            .ok_or_else(|| invalid_backup("The backup size is invalid"))?;
        if file.sha256.len() != 64
            || !file
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(invalid_backup(format!(
                "Invalid file hash for {}",
                file.path
            )));
        }
    }
    if total_size > MAX_ARCHIVE_BYTES {
        return Err(invalid_backup("The backup is too large to restore"));
    }
    if !paths.contains(&DATABASE_PATH.to_string()) {
        return Err(invalid_backup("The backup contains no library database"));
    }
    if !paths.contains(&PREFERENCES_PATH.to_string()) {
        return Err(invalid_backup("The backup contains no saved preferences"));
    }
    Ok(())
}

fn ensure_restore_space(destination: &Path, manifest: &BackupManifest) -> AppResult<()> {
    let archive_bytes = manifest.files.iter().try_fold(0_u64, |total, file| {
        total
            .checked_add(file.size)
            .ok_or_else(|| invalid_backup("The backup size is invalid"))
    })?;
    let database_bytes = manifest
        .files
        .iter()
        .find(|file| file.path == DATABASE_PATH)
        .map(|file| file.size)
        .unwrap_or(0);
    let required = archive_bytes
        .checked_add(database_bytes)
        .and_then(|bytes| bytes.checked_add(RESTORE_SPACE_RESERVE))
        .ok_or_else(|| invalid_backup("The backup size is invalid"))?;
    if available_space(destination)? < required {
        return Err(invalid_backup(
            "There is not enough free space to prepare this library copy",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn available_space(path: &Path) -> AppResult<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| invalid_backup("The restore location is invalid"))?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    if unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let stats = unsafe { stats.assume_init() };
    let blocks = u128::from(stats.f_bavail);
    let fragment_size = u128::from(stats.f_frsize);
    Ok(blocks
        .saturating_mul(fragment_size)
        .min(u128::from(u64::MAX)) as u64)
}

#[cfg(windows)]
fn available_space(path: &Path) -> AppResult<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut available = 0_u64;
    if unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(available)
}

fn validate_database_files(database: &Path, manifest: &BackupManifest) -> AppResult<()> {
    let conn = rusqlite::Connection::open_with_flags(
        database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let mut statement =
        conn.prepare("SELECT id, rel_path, cover_path, file_size FROM books ORDER BY id")?;
    let books = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if books.len() != manifest.book_count {
        return Err(invalid_backup(
            "The book count does not match the library database",
        ));
    }
    let files: BTreeMap<_, _> = manifest
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let mut referenced = BTreeSet::new();
    for (id, rel_path, cover_path, file_size) in &books {
        if id.len() != 64 || !is_lower_hex(id) || *file_size < 0 {
            return Err(invalid_backup(
                "The library database contains an invalid book file",
            ));
        }
        let expected_path = format!("books/{}/{id}.epub", &id[..2]);
        if rel_path != &expected_path {
            return Err(invalid_backup(
                "The library database contains an invalid book file",
            ));
        }
        let Some(book_file) = files.get(rel_path.as_str()) else {
            return Err(invalid_backup(format!(
                "The backup is missing a library file: {rel_path}"
            )));
        };
        if book_file.size != *file_size as u64 || book_file.sha256 != *id {
            return Err(invalid_backup(format!(
                "The book data does not match its library record: {rel_path}"
            )));
        }
        referenced.insert(rel_path.as_str());

        if let Some(cover_path) = cover_path {
            if !cover_path.starts_with(&format!("covers/{id}.")) {
                return Err(invalid_backup(
                    "The library database contains an invalid cover file",
                ));
            }
            if !files.contains_key(cover_path.as_str()) {
                return Err(invalid_backup(format!(
                    "The backup is missing a library file: {cover_path}"
                )));
            }
            referenced.insert(cover_path.as_str());
        }
    }
    for path in files.keys() {
        if (*path == DATABASE_PATH || *path == PREFERENCES_PATH) || referenced.contains(path) {
            continue;
        }
        return Err(invalid_backup(format!(
            "The backup contains an unreferenced library file: {path}"
        )));
    }
    Ok(())
}

fn validate_archive_path(path: &str) -> AppResult<()> {
    if path == DATABASE_PATH || path == PREFERENCES_PATH {
        return Ok(());
    }
    let parsed = path_from_archive(path)?;
    let parts = parsed
        .iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [root, shard, file] if root == "books" => {
            let Some((id, extension)) = file.rsplit_once('.') else {
                return Err(invalid_backup(format!("Unexpected entry path: {path}")));
            };
            if shard.len() == 2
                && is_lower_hex(shard)
                && id.len() == 64
                && is_lower_hex(id)
                && shard.as_ref() == &id[..2]
                && extension == "epub"
            {
                Ok(())
            } else {
                Err(invalid_backup(format!("Unexpected entry path: {path}")))
            }
        }
        [root, file] if root == "covers" => {
            let Some((id, extension)) = file.rsplit_once('.') else {
                return Err(invalid_backup(format!("Unexpected entry path: {path}")));
            };
            if id.len() == 64
                && is_lower_hex(id)
                && !extension.is_empty()
                && extension.len() <= 12
                && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
            {
                Ok(())
            } else {
                Err(invalid_backup(format!("Unexpected entry path: {path}")))
            }
        }
        _ => Err(invalid_backup(format!("Unexpected entry path: {path}"))),
    }
}

fn is_lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn path_from_archive(path: &str) -> AppResult<PathBuf> {
    let mut output = PathBuf::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') {
            return Err(invalid_backup(format!("Unsafe entry path: {path}")));
        }
        output.push(part);
    }
    if output.is_absolute()
        || output
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(invalid_backup(format!("Unsafe entry path: {path}")));
    }
    Ok(output)
}

fn collect_referenced_files(
    storage: &Storage,
    database: &Path,
    output: &mut Vec<SourceFile>,
) -> AppResult<usize> {
    let conn = rusqlite::Connection::open_with_flags(
        database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let mut statement =
        conn.prepare("SELECT id, rel_path, cover_path, file_size FROM books ORDER BY id")?;
    let books = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let book_count = books.len();
    let mut seen = BTreeSet::new();
    for (id, rel_path, cover_path, file_size) in books {
        add_managed_source(
            storage,
            &rel_path,
            Some(file_size.max(0) as u64),
            Some(id),
            &mut seen,
            output,
        )?;
        if let Some(cover_path) = cover_path {
            add_managed_source(storage, &cover_path, None, None, &mut seen, output)?;
        }
    }
    Ok(book_count)
}

fn add_managed_source(
    storage: &Storage,
    rel_path: &str,
    expected_size: Option<u64>,
    expected_sha256: Option<String>,
    seen: &mut BTreeSet<String>,
    output: &mut Vec<SourceFile>,
) -> AppResult<()> {
    validate_archive_path(rel_path)?;
    if !seen.insert(rel_path.to_string()) {
        return Err(backup_error(format!(
            "The library references the same file more than once: {rel_path}"
        )));
    }
    let source_path = storage.resolve_checked(rel_path)?;
    let metadata = std::fs::symlink_metadata(&source_path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(backup_error(format!(
            "The library file is not a regular file: {rel_path}"
        )));
    }
    output.push(SourceFile {
        archive_path: rel_path.to_string(),
        source_path,
        expected_size,
        expected_sha256,
    });
    Ok(())
}

fn hash_file(path: &Path) -> AppResult<(u64, String)> {
    let mut input = BufReader::new(File::open(path)?);
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as u64;
    }
    Ok((size, digest_hex(hasher.finalize())))
}

fn digest_hex(digest: impl AsRef<[u8]>) -> String {
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn compression_for(path: &Path) -> CompressionMethod {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("epub" | "jpg" | "jpeg" | "png" | "gif" | "webp" | "avif") => {
            CompressionMethod::Stored
        }
        _ => CompressionMethod::Deflated,
    }
}

fn install_prepared_restore(
    storage: &Storage,
    transaction: &Path,
    journal: &mut RestoreJournal,
) -> AppResult<()> {
    let previous = transaction.join(PREVIOUS_DIR);
    let incoming = transaction.join(INCOMING_DIR);
    std::fs::create_dir_all(&previous)?;

    move_to_previous(
        &storage.db_path(),
        &previous.join(DATABASE_PATH),
        1,
        transaction,
        journal,
    )?;
    move_to_previous(
        &storage.root().join("novus.db-wal"),
        &previous.join("novus.db-wal"),
        2,
        transaction,
        journal,
    )?;
    move_to_previous(
        &storage.root().join("novus.db-shm"),
        &previous.join("novus.db-shm"),
        3,
        transaction,
        journal,
    )?;
    move_to_previous(
        &storage.books_dir(),
        &previous.join("books"),
        4,
        transaction,
        journal,
    )?;
    move_to_previous(
        &storage.covers_dir(),
        &previous.join("covers"),
        5,
        transaction,
        journal,
    )?;
    install_path(
        &incoming.join(DATABASE_PATH),
        &storage.db_path(),
        6,
        transaction,
        journal,
    )?;
    install_path(
        &incoming.join("books"),
        &storage.books_dir(),
        7,
        transaction,
        journal,
    )?;
    install_path(
        &incoming.join("covers"),
        &storage.covers_dir(),
        8,
        transaction,
        journal,
    )?;

    Db::validate_file(&storage.db_path())?;
    validate_installed_files(storage)?;
    journal.state = "installed".to_string();
    journal.error = None;
    write_journal(transaction, journal)
}

fn move_to_previous(
    live: &Path,
    previous: &Path,
    step: u8,
    transaction: &Path,
    journal: &mut RestoreJournal,
) -> AppResult<()> {
    if journal.step >= step {
        return Ok(());
    }
    if !previous.exists() && live.exists() {
        rename_durable(live, previous)?;
    }
    journal.step = step;
    write_journal(transaction, journal)
}

fn install_path(
    incoming: &Path,
    live: &Path,
    step: u8,
    transaction: &Path,
    journal: &mut RestoreJournal,
) -> AppResult<()> {
    if journal.step >= step {
        return Ok(());
    }
    if incoming.exists() {
        if live.exists() {
            return Err(AppError::Other(format!(
                "Could not install the restored library because {} is still in use",
                live.display()
            )));
        }
        rename_durable(incoming, live)?;
    } else if !live.exists() {
        return Err(AppError::Other(format!(
            "The prepared restore is missing {}",
            incoming.display()
        )));
    }
    journal.step = step;
    write_journal(transaction, journal)
}

fn rollback_startup_restore(
    storage: &Storage,
    transaction: &Path,
    journal: &mut RestoreJournal,
) -> AppResult<()> {
    let previous = transaction.join(PREVIOUS_DIR);
    let incoming = transaction.join(INCOMING_DIR);

    return_to_incoming(&storage.covers_dir(), &incoming.join("covers"))?;
    return_to_incoming(&storage.books_dir(), &incoming.join("books"))?;
    return_to_incoming(&storage.db_path(), &incoming.join(DATABASE_PATH))?;
    remove_if_present(&storage.root().join("novus.db-wal"))?;
    remove_if_present(&storage.root().join("novus.db-shm"))?;

    restore_previous(&previous.join(DATABASE_PATH), &storage.db_path())?;
    restore_previous(
        &previous.join("novus.db-wal"),
        &storage.root().join("novus.db-wal"),
    )?;
    restore_previous(
        &previous.join("novus.db-shm"),
        &storage.root().join("novus.db-shm"),
    )?;
    restore_previous(&previous.join("books"), &storage.books_dir())?;
    restore_previous(&previous.join("covers"), &storage.covers_dir())?;

    journal.state = "failed".to_string();
    journal.step = 0;
    if journal.error.is_none() {
        journal.error = Some(
            "Novus kept your previous library because the restored copy could not be verified."
                .to_string(),
        );
    }
    write_journal(transaction, journal)
}

fn return_to_incoming(live: &Path, incoming: &Path) -> AppResult<()> {
    if incoming.exists() || !live.exists() {
        return Ok(());
    }
    if let Some(parent) = incoming.parent() {
        std::fs::create_dir_all(parent)?;
    }
    rename_durable(live, incoming)?;
    Ok(())
}

fn restore_previous(previous: &Path, live: &Path) -> AppResult<()> {
    if previous.exists() && !live.exists() {
        rename_durable(previous, live)?;
    }
    Ok(())
}

fn validate_installed_files(storage: &Storage) -> AppResult<()> {
    let conn = rusqlite::Connection::open_with_flags(
        storage.db_path(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let mut statement =
        conn.prepare("SELECT id, rel_path, cover_path, file_size FROM books ORDER BY id")?;
    let books = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, rel_path, cover_path, file_size) in books {
        let path = storage.resolve_checked(&rel_path)?;
        let (size, sha256) = hash_file(&path)?;
        if size != file_size.max(0) as u64 || sha256 != id {
            return Err(AppError::Other(format!(
                "The restored library file failed verification: {rel_path}"
            )));
        }
        if let Some(cover_path) = cover_path {
            let cover = storage.resolve_checked(&cover_path)?;
            if !cover.is_file() {
                return Err(AppError::Other(format!(
                    "The restored library is missing a cover: {cover_path}"
                )));
            }
        }
    }
    Ok(())
}

fn read_preferences(path: &Path) -> AppResult<LibraryPreferences> {
    let bytes = std::fs::read(path)?;
    if bytes.len() > MAX_PREFERENCES_BYTES {
        return Err(invalid_backup("The saved preferences are too large"));
    }
    let preferences: LibraryPreferences = serde_json::from_slice(&bytes)
        .map_err(|_| invalid_backup("The saved preferences are invalid"))?;
    validate_preferences(&preferences).map_err(|error| invalid_backup(error.to_string()))?;
    Ok(preferences)
}

fn validate_preferences(preferences: &LibraryPreferences) -> AppResult<()> {
    if preferences.app_theme != "light" && preferences.app_theme != "dark" {
        return Err(backup_error("App theme must be light or dark"));
    }
    if preferences.profile_name.chars().count() > 200 {
        return Err(backup_error("Profile name is too long"));
    }
    if !preferences.reader_settings.is_object() {
        return Err(backup_error("Reader settings are invalid"));
    }
    if !preferences.highlight_colors.is_object() {
        return Err(backup_error("Highlight colors are invalid"));
    }
    let bytes = serde_json::to_vec(preferences)
        .map_err(|error| backup_error(format!("Could not save preferences: {error}")))?;
    if bytes.len() > MAX_PREFERENCES_BYTES {
        return Err(backup_error("Saved preferences are too large"));
    }
    Ok(())
}

fn status_from_journal(journal: RestoreJournal) -> RestoreStatus {
    RestoreStatus {
        state: journal.state,
        backup_created_at: journal.backup_created_at,
        book_count: journal.book_count,
        file_count: journal.file_count,
        preferences: journal.preferences,
        error: journal.error,
    }
}

fn discard_transaction(storage: &Storage, transaction: &Path) -> AppResult<()> {
    let discard = (0_u16..1000)
        .map(|suffix| {
            storage.root().join(format!(
                "{DISCARD_PREFIX}{}-{}-{suffix}",
                std::process::id(),
                now_seconds()
            ))
        })
        .find(|path| !path.exists())
        .ok_or_else(|| AppError::Other("Novus could not close the restore safely".to_string()))?;
    rename_durable(transaction, &discard)?;
    let _ = std::fs::remove_dir_all(discard);
    Ok(())
}

fn rename_durable(source: &Path, destination: &Path) -> AppResult<()> {
    std::fs::rename(source, destination)?;
    if let Some(parent) = source.parent() {
        sync_directory(parent)?;
    }
    if destination.parent() != source.parent() {
        if let Some(parent) = destination.parent() {
            sync_directory(parent)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> AppResult<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> AppResult<()> {
    Ok(())
}

fn read_journal(transaction: &Path) -> AppResult<RestoreJournal> {
    let bytes = std::fs::read(transaction.join(RESTORE_JOURNAL))?;
    if bytes.len() > MAX_MANIFEST_BYTES as usize {
        return Err(AppError::Other(
            "The restore journal is too large".to_string(),
        ));
    }
    let journal: RestoreJournal = serde_json::from_slice(&bytes).map_err(|_| {
        AppError::Other("Novus could not read the recovery information".to_string())
    })?;
    if journal.version != 1 {
        return Err(AppError::Other(
            "This restore journal version is not supported".to_string(),
        ));
    }
    if !matches!(
        journal.state.as_str(),
        "prepared" | "install" | "installing" | "installed" | "rollingBack" | "failed"
    ) || journal.step > 8
        || journal.book_count > journal.file_count
        || journal.file_count > MAX_ARCHIVE_FILES
    {
        return Err(AppError::Other(
            "The restore journal is invalid".to_string(),
        ));
    }
    validate_preferences(&journal.preferences)
        .map_err(|_| AppError::Other("The restore journal is invalid".to_string()))?;
    Ok(journal)
}

fn write_journal(transaction: &Path, journal: &RestoreJournal) -> AppResult<()> {
    let bytes = serde_json::to_vec(journal)
        .map_err(|error| AppError::Other(format!("Could not save the restore journal: {error}")))?;
    let mut temporary = NamedTempFile::new_in(transaction)?;
    temporary.write_all(&bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(transaction.join(RESTORE_JOURNAL))
        .map_err(|error| AppError::Io(error.error))?;
    sync_directory(transaction)?;
    Ok(())
}

fn remove_if_present(path: &Path) -> AppResult<()> {
    match std::fs::remove_file(path) {
        Ok(()) => {
            if let Some(parent) = path.parent() {
                sync_directory(parent)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn backup_error(message: impl Into<String>) -> AppError {
    AppError::Other(message.into())
}

fn invalid_backup(message: impl Into<String>) -> AppError {
    AppError::Other(format!(
        "Novus could not restore this library copy. {}",
        message.into()
    ))
}

fn backup_archive_error(_error: zip::result::ZipError) -> AppError {
    backup_error("Novus could not save the library copy")
}

fn restore_archive_error(_error: zip::result::ZipError) -> AppError {
    invalid_backup("The archive could not be read")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Book, Highlight};

    fn create_test_library() -> (tempfile::TempDir, Storage, Db) {
        let temp = tempfile::tempdir().unwrap();
        let storage = Storage::for_test(temp.path().join("library")).unwrap();
        let db = Db::open(&storage.db_path(), || storage.remove_legacy_voice_data()).unwrap();
        (temp, storage, db)
    }

    fn add_book(storage: &Storage, db: &Db) {
        let id = digest_hex(Sha256::digest(b"book"));
        let shard = &id[..2];
        let rel_path = format!("books/{shard}/{id}.epub");
        let cover_path = format!("covers/{id}.png");
        std::fs::create_dir_all(storage.root().join(format!("books/{shard}"))).unwrap();
        std::fs::write(storage.resolve_checked(&rel_path).unwrap(), b"book").unwrap();
        std::fs::write(storage.resolve_checked(&cover_path).unwrap(), b"cover").unwrap();

        db.insert_book(&Book {
            id: id.clone(),
            title: "The Example".to_string(),
            author: "A. Reader".to_string(),
            format: "epub".to_string(),
            rel_path,
            cover_path: Some(cover_path),
            page_count: None,
            language: Some("en".to_string()),
            description: None,
            file_size: 4,
            added_at: 1,
            progress: 0.0,
            last_read_at: None,
        })
        .unwrap();
        db.save_reading_state(&id, Some("epubcfi(/6/2)".to_string()), 0.4)
            .unwrap();
        let collection = db.create_collection("Favorites").unwrap();
        db.set_collection_membership(collection.id, &id, true)
            .unwrap();
        db.add_highlight(&Highlight {
            id: "highlight-1".to_string(),
            book_id: id,
            cfi: "epubcfi(/6/2!/4/2)".to_string(),
            text: "A useful line".to_string(),
            chapter_label: Some("One".to_string()),
            chapter_href: Some("one.xhtml".to_string()),
            section_index: 0,
            location: Some(1),
            color: "sage".to_string(),
            note: Some("Remember this".to_string()),
            created_at: 2,
        })
        .unwrap();
    }

    fn preferences() -> LibraryPreferences {
        LibraryPreferences {
            app_theme: "dark".to_string(),
            profile_name: "Guest library".to_string(),
            reader_settings: serde_json::json!({"readTheme": "dark"}),
            highlight_colors: serde_json::json!({}),
            continue_shelf_open: true,
        }
    }

    #[test]
    fn backup_round_trip_restores_files_and_reading_data() {
        let (temp, storage, db) = create_test_library();
        add_book(&storage, &db);
        let backup_path = temp.path().join("library.novus-backup");

        let created = create_backup(&storage, &db, &backup_path, &preferences()).unwrap();
        assert_eq!(created.book_count, 1);
        assert_eq!(created.file_count, 4);

        let id = digest_hex(Sha256::digest(b"book"));
        let shard = &id[..2];
        db.delete_book(&id).unwrap();
        drop(db);
        std::fs::remove_dir_all(storage.books_dir()).unwrap();
        std::fs::remove_dir_all(storage.covers_dir()).unwrap();
        std::fs::create_dir_all(storage.books_dir()).unwrap();
        std::fs::create_dir_all(storage.covers_dir()).unwrap();

        let restored = prepare_restore(&storage, &backup_path).unwrap();
        assert_eq!(restored.book_count, 1);
        assert_eq!(restored.file_count, 4);
        commit_restore(&storage).unwrap();
        recover_interrupted_restore(&storage).unwrap();

        let status = restore_status(&storage).unwrap().unwrap();
        assert_eq!(status.state, "installed");
        assert_eq!(status.preferences.app_theme, "dark");

        let db = Db::open(&storage.db_path(), || storage.remove_legacy_voice_data()).unwrap();
        assert_eq!(db.count_books().unwrap(), 1);
        assert_eq!(db.list_collections().unwrap()[0].name, "Favorites");
        assert_eq!(
            db.list_highlights(&id).unwrap()[0].note.as_deref(),
            Some("Remember this")
        );
        assert_eq!(
            std::fs::read(storage.books_dir().join(format!("{shard}/{id}.epub"))).unwrap(),
            b"book"
        );
        finish_restore(&storage).unwrap();
        assert!(restore_status(&storage).unwrap().is_none());
    }

    #[test]
    fn invalid_archive_is_rejected_without_changing_the_library() {
        let (temp, storage, db) = create_test_library();
        add_book(&storage, &db);
        let backup_path = temp.path().join("invalid.novus-backup");
        std::fs::write(&backup_path, b"not an archive").unwrap();

        let error = prepare_restore(&storage, &backup_path).unwrap_err();
        assert!(error.to_string().contains("archive could not be read"));
        assert_eq!(db.count_books().unwrap(), 1);
    }

    #[test]
    fn backup_cannot_replace_managed_library_data() {
        let (_temp, storage, db) = create_test_library();
        add_book(&storage, &db);
        let database = storage.db_path();
        let before = std::fs::read(&database).unwrap();

        let error = create_backup(&storage, &db, &database, &preferences()).unwrap_err();

        assert!(error
            .to_string()
            .contains("outside Novus's library storage"));
        assert_eq!(std::fs::read(database).unwrap(), before);
        assert_eq!(db.count_books().unwrap(), 1);
    }

    #[test]
    fn rolling_back_resumes_after_the_previous_library_is_restored() {
        let (temp, storage, db) = create_test_library();
        add_book(&storage, &db);
        let backup_path = temp.path().join("library.novus-backup");
        create_backup(&storage, &db, &backup_path, &preferences()).unwrap();

        let id = digest_hex(Sha256::digest(b"book"));
        db.delete_book(&id).unwrap();
        drop(db);
        std::fs::remove_dir_all(storage.books_dir()).unwrap();
        std::fs::remove_dir_all(storage.covers_dir()).unwrap();
        std::fs::create_dir_all(storage.books_dir()).unwrap();
        std::fs::create_dir_all(storage.covers_dir()).unwrap();

        prepare_restore(&storage, &backup_path).unwrap();
        commit_restore(&storage).unwrap();
        recover_interrupted_restore(&storage).unwrap();
        request_restore_rollback(&storage).unwrap();

        let transaction = storage.root().join(RESTORE_DIR);
        let previous = transaction.join(PREVIOUS_DIR);
        let incoming = transaction.join(INCOMING_DIR);
        return_to_incoming(&storage.covers_dir(), &incoming.join("covers")).unwrap();
        return_to_incoming(&storage.books_dir(), &incoming.join("books")).unwrap();
        return_to_incoming(&storage.db_path(), &incoming.join(DATABASE_PATH)).unwrap();
        remove_if_present(&storage.root().join("novus.db-wal")).unwrap();
        remove_if_present(&storage.root().join("novus.db-shm")).unwrap();
        restore_previous(&previous.join(DATABASE_PATH), &storage.db_path()).unwrap();
        restore_previous(
            &previous.join("novus.db-wal"),
            &storage.root().join("novus.db-wal"),
        )
        .unwrap();
        restore_previous(
            &previous.join("novus.db-shm"),
            &storage.root().join("novus.db-shm"),
        )
        .unwrap();
        restore_previous(&previous.join("books"), &storage.books_dir()).unwrap();
        restore_previous(&previous.join("covers"), &storage.covers_dir()).unwrap();

        recover_interrupted_restore(&storage).unwrap();

        let status = restore_status(&storage).unwrap().unwrap();
        assert_eq!(status.state, "failed");
        let db = Db::open(&storage.db_path(), || storage.remove_legacy_voice_data()).unwrap();
        assert_eq!(db.count_books().unwrap(), 0);
    }

    #[test]
    fn a_restore_that_is_not_acknowledged_rolls_back_on_the_next_start() {
        let (temp, storage, db) = create_test_library();
        add_book(&storage, &db);
        let backup_path = temp.path().join("library.novus-backup");
        create_backup(&storage, &db, &backup_path, &preferences()).unwrap();

        let id = digest_hex(Sha256::digest(b"book"));
        db.delete_book(&id).unwrap();
        drop(db);
        std::fs::remove_dir_all(storage.books_dir()).unwrap();
        std::fs::remove_dir_all(storage.covers_dir()).unwrap();
        std::fs::create_dir_all(storage.books_dir()).unwrap();
        std::fs::create_dir_all(storage.covers_dir()).unwrap();

        prepare_restore(&storage, &backup_path).unwrap();
        commit_restore(&storage).unwrap();
        recover_interrupted_restore(&storage).unwrap();
        assert_eq!(
            restore_status(&storage).unwrap().unwrap().state,
            "installed"
        );

        recover_interrupted_restore(&storage).unwrap();

        let status = restore_status(&storage).unwrap().unwrap();
        assert_eq!(status.state, "failed");
        let db = Db::open(&storage.db_path(), || storage.remove_legacy_voice_data()).unwrap();
        assert_eq!(db.count_books().unwrap(), 0);
    }

    #[test]
    fn incomplete_discard_does_not_block_the_next_start() {
        let (_temp, storage, db) = create_test_library();
        let root = storage.root().to_path_buf();
        std::fs::create_dir(root.join(RESTORE_DIR)).unwrap();
        drop(db);
        drop(storage);

        let reopened = Storage::for_test(root.clone()).unwrap();

        assert!(!root.join(RESTORE_DIR).exists());
        drop(reopened);
    }

    #[test]
    fn managed_archive_paths_are_portable() {
        assert!(validate_archive_path(
            "books/ab/ab00000000000000000000000000000000000000000000000000000000000000.epub"
        )
        .is_ok());
        assert!(validate_archive_path(
            "covers/ab00000000000000000000000000000000000000000000000000000000000000.png"
        )
        .is_ok());
        assert!(validate_archive_path("covers/NUL").is_err());
        assert!(validate_archive_path("covers/name:stream").is_err());
        assert!(validate_archive_path("../novus.db").is_err());
    }
}
