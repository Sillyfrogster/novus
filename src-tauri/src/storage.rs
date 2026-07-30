use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

pub struct Storage {
    root: PathBuf,
    _lock: File,
}

impl Storage {
    /// Open and recover the library storage.
    pub fn initialize(app: &AppHandle) -> AppResult<Self> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Path(format!("could not resolve app data dir: {e}")))?;

        std::fs::create_dir_all(&root)?;
        let storage = Self::open(root, Duration::from_secs(3))?;
        crate::backup::cleanup_stale_work(&storage);
        crate::backup::recover_interrupted_restore(&storage)?;
        std::fs::create_dir_all(storage.books_dir())?;
        std::fs::create_dir_all(storage.covers_dir())?;
        Ok(storage)
    }

    #[cfg(test)]
    pub fn for_test(root: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&root)?;
        let storage = Self::open(root, Duration::ZERO)?;
        crate::backup::cleanup_stale_work(&storage);
        crate::backup::recover_interrupted_restore(&storage)?;
        std::fs::create_dir_all(storage.books_dir())?;
        std::fs::create_dir_all(storage.covers_dir())?;
        Ok(storage)
    }

    fn open(root: PathBuf, wait: Duration) -> AppResult<Self> {
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(root.join(".novus.lock"))?;
        let started = Instant::now();
        loop {
            match lock.try_lock() {
                Ok(()) => return Ok(Self { root, _lock: lock }),
                Err(TryLockError::WouldBlock) if started.elapsed() < wait => {
                    let remaining = wait.saturating_sub(started.elapsed());
                    std::thread::sleep(remaining.min(Duration::from_millis(50)));
                }
                Err(TryLockError::WouldBlock) => {
                    return Err(AppError::Other(
                        "Another Novus window is already using this library".to_string(),
                    ));
                }
                Err(TryLockError::Error(error)) => return Err(error.into()),
            }
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn db_path(&self) -> PathBuf {
        self.root.join("novus.db")
    }

    pub fn books_dir(&self) -> PathBuf {
        self.root.join("books")
    }

    pub fn covers_dir(&self) -> PathBuf {
        self.root.join("covers")
    }

    pub fn remove_legacy_voice_data(&self) -> AppResult<()> {
        let path = self.root.join("voice-packs");
        match std::fs::remove_dir_all(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn resolve_checked(&self, rel_path: &str) -> AppResult<PathBuf> {
        let path = Path::new(rel_path);
        if path.is_absolute() {
            return Err(AppError::Path("Managed path must be relative".to_string()));
        }

        let mut components = path.components();
        let Some(Component::Normal(top)) = components.next() else {
            return Err(AppError::Path("Managed path is invalid".to_string()));
        };
        if top != "books" && top != "covers" {
            return Err(AppError::Path(
                "Managed path is outside the library".to_string(),
            ));
        }
        let mut resolved = self.root.join(top);
        match std::fs::symlink_metadata(&resolved) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(AppError::Path(
                    "Managed path contains a symbolic link".to_string(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let mut has_child = false;
        for component in components {
            let Component::Normal(part) = component else {
                return Err(AppError::Path("Managed path is invalid".to_string()));
            };
            if !is_portable_component(part.to_string_lossy().as_ref()) {
                return Err(AppError::Path("Managed path is invalid".to_string()));
            }
            has_child = true;
            resolved.push(part);
            match std::fs::symlink_metadata(&resolved) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(AppError::Path(
                        "Managed path contains a symbolic link".to_string(),
                    ));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        if !has_child {
            return Err(AppError::Path("Managed path is invalid".to_string()));
        }
        Ok(resolved)
    }
}

fn is_portable_component(value: &str) -> bool {
    if value.is_empty()
        || value.ends_with('.')
        || value.ends_with(' ')
        || value
            .chars()
            .any(|character| character.is_control() || r#"<>:"/\|?*"#.contains(character))
    {
        return false;
    }
    let stem = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_uppercase();
    !matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_storage_owner_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("library");
        let _first = Storage::for_test(root.clone()).unwrap();

        let error = match Storage::for_test(root) {
            Ok(_) => panic!("a second storage owner acquired the lock"),
            Err(error) => error,
        };

        assert!(error.to_string().contains("already using this library"));
    }

    #[test]
    fn startup_removes_interrupted_backup_work() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("library");
        let storage = Storage::for_test(root.clone()).unwrap();
        for name in [
            ".backup-orphan",
            ".restore-preparing-orphan",
            ".restore-discard-orphan",
        ] {
            std::fs::create_dir(root.join(name)).unwrap();
            std::fs::write(root.join(name).join("partial"), b"unfinished").unwrap();
        }
        drop(storage);

        let reopened = Storage::for_test(root.clone()).unwrap();

        assert!(!root.join(".backup-orphan").exists());
        assert!(!root.join(".restore-preparing-orphan").exists());
        assert!(!root.join(".restore-discard-orphan").exists());
        drop(reopened);
    }

    #[cfg(unix)]
    #[test]
    fn managed_paths_cannot_cross_a_symbolic_link() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let storage = Storage::for_test(temp.path().join("library")).unwrap();
        let outside = temp.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        symlink(&outside, storage.books_dir().join("link")).unwrap();

        assert!(storage.resolve_checked("books/link/book.epub").is_err());
    }
}
