use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

pub struct Storage {
    root: PathBuf,
}

impl Storage {
    /// Resolve the managed root from the Tauri app handle and ensure the
    /// directory tree exists. Called once at startup.
    pub fn initialize(app: &AppHandle) -> AppResult<Self> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Path(format!("could not resolve app data dir: {e}")))?;

        let storage = Self { root };
        std::fs::create_dir_all(storage.books_dir())?;
        std::fs::create_dir_all(storage.covers_dir())?;
        Ok(storage)
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

    /// Absolute path for a managed book file given its stored relative path.
    pub fn resolve(&self, rel_path: &str) -> PathBuf {
        self.root.join(rel_path)
    }
}
