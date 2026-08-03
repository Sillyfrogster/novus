use std::sync::Mutex;

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use tauri::State;

const CLIENT_ID: &str = "1533832044885442570";

pub struct DiscordPresence(Mutex<Option<DiscordIpcClient>>);

impl Default for DiscordPresence {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[tauri::command]
pub fn set_discord_presence(
    presence: State<'_, DiscordPresence>,
    title: String,
    chapter: String,
    current_page: Option<u32>,
    total_pages: Option<u32>,
    progress: u8,
    started_at: i64,
) {
    let mut status = Vec::new();
    if !chapter.is_empty() {
        status.push(chapter);
    }
    if let (Some(current), Some(total)) = (current_page, total_pages) {
        status.push(format!("Page {current} of {total}"));
    }
    status.push(format!("{progress}% complete"));

    let title: String = title.chars().take(128).collect();
    let status: String = status.join(" • ").chars().take(128).collect();
    let activity = activity::Activity::new()
        .details(title)
        .state(status)
        .timestamps(activity::Timestamps::new().start(started_at))
        .assets(
            activity::Assets::new()
                .large_image("novus")
                .large_text("Novus"),
        );

    let mut client = presence.0.lock().expect("Discord presence lock poisoned");
    if client.is_none() {
        let mut connection = DiscordIpcClient::new(CLIENT_ID);
        if connection.connect().is_err() {
            return;
        }
        *client = Some(connection);
    }
    if client
        .as_mut()
        .expect("Discord client just connected")
        .set_activity(activity)
        .is_err()
    {
        *client = None;
    }
}

#[tauri::command]
pub fn clear_discord_presence(presence: State<'_, DiscordPresence>) {
    if let Some(mut client) = presence
        .0
        .lock()
        .expect("Discord presence lock poisoned")
        .take()
    {
        let _ = client.clear_activity();
        let _ = client.close();
    }
}
