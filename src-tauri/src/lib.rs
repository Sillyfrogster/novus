mod backup;
mod commands;
mod db;
mod error;
mod import;
mod publication;
mod storage;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use db::Db;
use storage::Storage;
use tauri::Manager;

pub struct Novus {
    pub storage: Arc<Storage>,
    pub db: Arc<Db>,
    pub content_gate: Arc<RwLock<()>>,
}

pub struct ZoomGuard(pub Arc<AtomicBool>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let zoom_locked = Arc::new(AtomicBool::new(true));
    let publications = publication::PublicationRegistry::default();
    let resource_publications = publications.clone();
    let cleanup_publications = publications.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ZoomGuard(zoom_locked.clone()))
        .manage(publications)
        .register_asynchronous_uri_scheme_protocol(
            "novus-epub",
            move |context, request, responder| {
                publication::serve_publication_request(
                    resource_publications.clone(),
                    context.webview_label().to_owned(),
                    request,
                    responder,
                );
            },
        )
        .on_window_event(move |window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                cleanup_publications.close_owner(window.label());
            }
        })
        .setup(move |app| {
            let storage = Storage::initialize(app.handle())?;
            let db = Db::open(&storage.db_path(), || storage.remove_legacy_voice_data())?;
            app.manage(Novus {
                storage: Arc::new(storage),
                db: Arc::new(db),
                content_gate: Arc::new(RwLock::new(())),
            });

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
            commands::create_library_backup,
            commands::prepare_library_restore,
            commands::commit_library_restore,
            commands::cancel_library_restore,
            commands::library_restore_status,
            commands::finish_library_restore,
            commands::rollback_library_restore,
            commands::import_books,
            commands::remove_book,
            commands::book_toc,
            publication::registry::publication_open,
            publication::registry::publication_section,
            publication::registry::publication_close,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
