use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackManifest {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub language: String,
    pub description: String,
    pub voices: Vec<VoiceInfo>,
    pub size_bytes: u64,
    pub url: String,
    pub sha256: String,
    pub license: String,
    pub word_timings: bool,
    pub tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Registry {
    pub version: u32,
    pub packs: Vec<PackManifest>,
}

/// An installed pack as reported to the frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPack {
    pub id: String,
    pub engine: String,
    pub language: String,
    pub voices: Vec<VoiceInfo>,
    pub word_timings: bool,
    pub size_bytes: u64,
}

/// Minimal view of a pack's own config.json (written at pack build time).
#[derive(Debug, Deserialize)]
pub struct PackConfig {
    pub id: String,
    pub engine: String,
    pub language: String,
    pub voices: std::collections::HashMap<String, String>,
    #[serde(rename = "wordTimings", default)]
    pub word_timings: bool,
    /// Optional pretty names: voiceId -> display name.
    #[serde(rename = "voiceNames", default)]
    pub voice_names: std::collections::HashMap<String, String>,
}

/// What `synthesize_sentence` returns to the webview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesisResult {
    pub pcm_base64: String,
    pub sample_rate: u32,
    pub duration_ms: u32,
    pub words: Vec<WordTiming>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordTiming {
    pub start_ms: u32,
    pub end_ms: u32,
    pub start_char: u32,
    pub end_char: u32,
}

/// Progress event payload for `voice-pack-progress`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub pack_id: String,
    pub received: u64,
    pub total: u64,
}
