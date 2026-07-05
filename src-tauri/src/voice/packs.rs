use crate::error::{AppError, AppResult};
use crate::voice::types::{DownloadProgress, InstalledPack, PackConfig, PackManifest, Registry, VoiceInfo};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Emitter;

const REGISTRY_URL: &str =
    "https://github.com/Sillyfrogster/novus-voices/releases/latest/download/registry.json";

pub fn registry_source() -> String {
    std::env::var("NOVUS_VOICE_REGISTRY").unwrap_or_else(|_| REGISTRY_URL.to_string())
}

pub fn fetch_registry() -> AppResult<Vec<PackManifest>> {
    let source = registry_source();
    let raw = if source.starts_with("http") {
        reqwest::blocking::get(&source)
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.text())
            .map_err(|e| AppError::Other(format!("fetching voice registry: {e}")))?
    } else {
        std::fs::read_to_string(&source)?
    };
    let registry: Registry =
        serde_json::from_str(&raw).map_err(|e| AppError::Other(format!("bad registry: {e}")))?;
    Ok(registry.packs)
}

pub fn list_installed(packs_dir: &Path) -> AppResult<Vec<InstalledPack>> {
    let mut installed = Vec::new();
    let entries = match std::fs::read_dir(packs_dir) {
        Ok(e) => e,
        Err(_) => return Ok(installed), // nothing downloaded yet
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        let config_path = dir.join("config.json");
        if !config_path.is_file() {
            continue; // .tmp dirs, stray files
        }
        let Ok(raw) = std::fs::read_to_string(&config_path) else { continue };
        let Ok(config) = serde_json::from_str::<PackConfig>(&raw) else { continue };
        let mut voices: Vec<VoiceInfo> = config
            .voices
            .keys()
            .map(|id| VoiceInfo {
                id: id.clone(),
                name: config.voice_names.get(id).cloned().unwrap_or_else(|| id.clone()),
            })
            .collect();
        voices.sort_by(|a, b| a.name.cmp(&b.name));
        installed.push(InstalledPack {
            id: config.id,
            engine: config.engine,
            language: config.language,
            voices,
            word_timings: config.word_timings,
            size_bytes: dir_size(&dir),
        });
    }
    installed.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(installed)
}

pub fn download(
    app: &tauri::AppHandle,
    packs_dir: &Path,
    manifest: &PackManifest,
) -> AppResult<()> {
    std::fs::create_dir_all(packs_dir)?;
    let archive_path = packs_dir.join(format!("{}.zip.part", manifest.id));
    let final_dir = packs_dir.join(&manifest.id);
    if final_dir.exists() {
        return Ok(()); // already installed
    }

    fetch_archive(app, manifest, &archive_path)?;

    let digest = sha256_file(&archive_path)?;
    if !digest.eq_ignore_ascii_case(&manifest.sha256) {
        let _ = std::fs::remove_file(&archive_path);
        return Err(AppError::Other(
            "voice pack failed integrity check; please try again".into(),
        ));
    }

    let tmp_dir = packs_dir.join(format!("{}.tmp", manifest.id));
    let _ = std::fs::remove_dir_all(&tmp_dir);
    extract_zip(&archive_path, &tmp_dir)?;
    let _ = std::fs::remove_file(&archive_path);

    let root = single_child_dir(&tmp_dir).unwrap_or_else(|| tmp_dir.clone());
    if !root.join("config.json").is_file() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(AppError::Other("voice pack archive has no config.json".into()));
    }
    std::fs::rename(&root, &final_dir)?;
    let _ = std::fs::remove_dir_all(&tmp_dir);
    Ok(())
}

pub fn delete(packs_dir: &Path, pack_id: &str) -> AppResult<()> {
    if pack_id.contains(['/', '\\']) || pack_id.contains("..") {
        return Err(AppError::Other("invalid pack id".into()));
    }
    let dir = packs_dir.join(pack_id);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

fn fetch_archive(app: &tauri::AppHandle, manifest: &PackManifest, dest: &Path) -> AppResult<()> {
    let mut out = std::fs::File::create(dest)?;
    if manifest.url.starts_with("http") {
        let mut response = reqwest::blocking::get(&manifest.url)
            .and_then(|r| r.error_for_status())
            .map_err(|e| AppError::Other(format!("download failed: {e}")))?;
        let total = response.content_length().unwrap_or(manifest.size_bytes);
        let mut received: u64 = 0;
        let mut last_emit = std::time::Instant::now();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = response
                .read(&mut buf)
                .map_err(|e| AppError::Other(format!("download interrupted: {e}")))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])?;
            received += n as u64;
            if last_emit.elapsed().as_millis() >= 150 {
                last_emit = std::time::Instant::now();
                let _ = app.emit(
                    "voice-pack-progress",
                    DownloadProgress { pack_id: manifest.id.clone(), received, total },
                );
            }
        }
        let _ = app.emit(
            "voice-pack-progress",
            DownloadProgress { pack_id: manifest.id.clone(), received, total },
        );
    } else {
        let mut src = std::fs::File::open(&manifest.url)?;
        std::io::copy(&mut src, &mut out)?;
    }
    Ok(())
}

fn sha256_file(path: &Path) -> AppResult<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

fn extract_zip(archive: &Path, dest: &Path) -> AppResult<()> {
    let file = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Other(format!("bad voice pack archive: {e}")))?;
    zip.extract(dest)
        .map_err(|e| AppError::Other(format!("unpacking voice pack: {e}")))?;
    Ok(())
}

fn single_child_dir(dir: &Path) -> Option<PathBuf> {
    let mut dirs = Vec::new();
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_file() {
            return None;
        }
        dirs.push(path);
    }
    (dirs.len() == 1).then(|| dirs.remove(0))
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            total += if path.is_dir() {
                dir_size(&path)
            } else {
                entry.metadata().map(|m| m.len()).unwrap_or(0)
            };
        }
    }
    total
}
