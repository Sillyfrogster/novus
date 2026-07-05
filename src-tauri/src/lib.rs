mod commands;
mod db;
mod error;
mod import;
mod storage;
mod voice;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use db::Db;
use storage::Storage;
use tauri::Manager;
use voice::VoiceService;

pub struct Novus {
    pub storage: Storage,
    pub db: Db,
    pub voice: Arc<VoiceService>,
}

pub struct ZoomGuard(pub Arc<AtomicBool>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let zoom_locked = Arc::new(AtomicBool::new(true));

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ZoomGuard(zoom_locked.clone()))
        .setup(move |app| {
            let storage = Storage::initialize(app.handle())?;
            let db = Db::open(&storage.db_path())?;
            let voice = Arc::new(VoiceService::new(storage.voice_packs_dir()));
            app.manage(Novus { storage, db, voice });

            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                let locked = zoom_locked.clone();
                let _ = window.with_webview(move |webview| {
                    use webkit2gtk::WebViewExt;
                    let view = webview.inner();
                    view.connect_zoom_level_notify(move |view| {
                        if locked.load(Ordering::Relaxed) && (view.zoom_level() - 1.0).abs() > 0.001
                        {
                            view.set_zoom_level(1.0);
                        }
                    });
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_books,
            commands::library_count,
            commands::storage_root,
            commands::import_books,
            commands::remove_book,
            commands::book_toc,
            commands::get_reading_state,
            commands::save_reading_state,
            commands::list_collections,
            commands::create_collection,
            commands::delete_collection,
            commands::set_collection_membership,
            commands::record_session,
            commands::insights_data,
            commands::set_zoom_locked,
            commands::list_highlights,
            commands::add_highlight,
            commands::set_highlight_color,
            commands::set_highlight_note,
            commands::delete_highlight,
            commands::write_file,
            commands::fetch_voice_registry,
            commands::list_voice_packs,
            commands::download_voice_pack,
            commands::delete_voice_pack,
            commands::synthesize_sentence,
            commands::tts_shutdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
