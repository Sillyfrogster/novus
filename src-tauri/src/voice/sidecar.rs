use crate::error::{AppError, AppResult};
use crate::voice::types::SynthesisResult;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

pub struct Sidecar {
    child: Child,
    stdin: std::process::ChildStdin,
    lines: Receiver<String>,
    next_id: u64,
    pub loaded_pack_dir: Option<PathBuf>,
}

impl Sidecar {
    pub fn spawn() -> AppResult<Sidecar> {
        let bin = resolve_binary()?;
        let mut command = Command::new(&bin);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // prevent console window
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|e| AppError::Other(format!("spawning {}: {e}", bin.display())))?;

        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");

        let (tx, lines) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        Ok(Sidecar { child, stdin, lines, next_id: 1, loaded_pack_dir: None })
    }

    pub fn load_voice(&mut self, pack_dir: &Path) -> AppResult<()> {
        let reply = self.request(json!({
            "cmd": "load_voice",
            "packDir": pack_dir,
        }))?;
        if !reply["ok"].as_bool().unwrap_or(false) {
            return Err(AppError::Other(format!(
                "voice load failed: {}",
                reply["error"].as_str().unwrap_or("unknown error")
            )));
        }
        self.loaded_pack_dir = Some(pack_dir.to_path_buf());
        Ok(())
    }

    pub fn synthesize(&mut self, text: &str, voice_id: &str, speed: f32) -> AppResult<SynthesisResult> {
        let reply = self.request(json!({
            "cmd": "synthesize",
            "text": text,
            "voiceId": voice_id,
            "speed": speed,
        }))?;
        if !reply["ok"].as_bool().unwrap_or(false) {
            return Err(AppError::Other(format!(
                "synthesis failed: {}",
                reply["error"].as_str().unwrap_or("unknown error")
            )));
        }
        serde_json::from_value(reply)
            .map_err(|e| AppError::Other(format!("bad synthesis reply: {e}")))
    }

    /// Ask the process to exit, then make sure it does.
    pub fn shutdown(mut self) {
        let id = self.next_id;
        let _ = writeln!(self.stdin, "{}", json!({"id": id, "cmd": "shutdown"}));
        let _ = self.stdin.flush();
        std::thread::sleep(Duration::from_millis(150));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    fn request(&mut self, mut payload: Value) -> AppResult<Value> {
        let id = self.next_id;
        self.next_id += 1;
        payload["id"] = json!(id);

        writeln!(self.stdin, "{payload}")
            .and_then(|_| self.stdin.flush())
            .map_err(|e| AppError::Other(format!("sidecar write failed: {e}")))?;

        let deadline = std::time::Instant::now() + REQUEST_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            match self.lines.recv_timeout(remaining) {
                Ok(line) => {
                    let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
                    if value["id"].as_u64() == Some(id) {
                        return Ok(value);
                    }
                    // Stale reply from a cancelled request: ignore.
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err(AppError::Other("voice engine timed out".into()));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(AppError::Other("voice engine exited".into()));
                }
            }
        }
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Locate the novus-voice binary.
fn resolve_binary() -> AppResult<PathBuf> {
    if let Ok(path) = std::env::var("NOVUS_VOICE_BIN") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }

    let exe_name = if cfg!(windows) { "novus-voice.exe" } else { "novus-voice" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(exe_name);
            if bundled.is_file() {
                return Ok(bundled);
            }
        }
    }

    let staged = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if let Ok(entries) = std::fs::read_dir(&staged) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with("novus-voice-") && entry.path().is_file() {
                return Ok(entry.path());
            }
        }
    }

    Err(AppError::Other(
        "novus-voice binary not found (run `bun scripts/sidecar.mjs` to fetch it, or set NOVUS_VOICE_BIN)".into(),
    ))
}
