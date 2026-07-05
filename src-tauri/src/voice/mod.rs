mod packs;
mod sidecar;
pub mod types;

use crate::error::{AppError, AppResult};
use sidecar::Sidecar;
use std::path::PathBuf;
use std::sync::Mutex;
use types::{InstalledPack, PackManifest, SynthesisResult};

pub struct VoiceService {
    packs_dir: PathBuf,
    sidecar: Mutex<Option<Sidecar>>,
}

impl VoiceService {
    pub fn new(packs_dir: PathBuf) -> Self {
        VoiceService { packs_dir, sidecar: Mutex::new(None) }
    }

    pub fn fetch_registry(&self) -> AppResult<Vec<PackManifest>> {
        packs::fetch_registry()
    }

    pub fn list_installed(&self) -> AppResult<Vec<InstalledPack>> {
        packs::list_installed(&self.packs_dir)
    }

    pub fn download(&self, app: &tauri::AppHandle, manifest: &PackManifest) -> AppResult<()> {
        packs::download(app, &self.packs_dir, manifest)
    }

    pub fn delete(&self, pack_id: &str) -> AppResult<()> {
        // Never delete a pack out from under a loaded session.
        let mut guard = self.lock();
        if let Some(side) = guard.as_ref() {
            let loaded = side
                .loaded_pack_dir
                .as_ref()
                .and_then(|d| d.file_name())
                .map(|n| n.to_string_lossy().to_string());
            if loaded.as_deref() == Some(pack_id) {
                if let Some(side) = guard.take() {
                    side.shutdown();
                }
            }
        }
        drop(guard);
        packs::delete(&self.packs_dir, pack_id)
    }

    pub fn synthesize(
        &self,
        pack_id: &str,
        voice_id: &str,
        text: &str,
        speed: f32,
    ) -> AppResult<SynthesisResult> {
        match self.try_synthesize(pack_id, voice_id, text, speed) {
            Err(AppError::Other(msg)) if msg.contains("exited") || msg.contains("write failed") => {
                *self.lock() = None; // drop the dead process, then retry once
                self.try_synthesize(pack_id, voice_id, text, speed)
            }
            result => result,
        }
    }

    pub fn shutdown(&self) {
        if let Some(side) = self.lock().take() {
            side.shutdown();
        }
    }

    fn try_synthesize(
        &self,
        pack_id: &str,
        voice_id: &str,
        text: &str,
        speed: f32,
    ) -> AppResult<SynthesisResult> {
        let pack_dir = self.packs_dir.join(pack_id);
        if !pack_dir.join("config.json").is_file() {
            return Err(AppError::Other(format!("voice pack '{pack_id}' is not installed")));
        }

        let mut guard = self.lock();
        if guard.is_none() {
            *guard = Some(Sidecar::spawn()?);
        }
        let side = guard.as_mut().expect("just spawned");
        if side.loaded_pack_dir.as_deref() != Some(pack_dir.as_path()) {
            side.load_voice(&pack_dir)?;
        }
        side.synthesize(text, voice_id, speed)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Sidecar>> {
        self.sidecar.lock().unwrap_or_else(|p| p.into_inner())
    }
}

impl Drop for VoiceService {
    fn drop(&mut self) {
        self.shutdown();
    }
}
