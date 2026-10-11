mod commands;
mod exiftool;
mod menu;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .menu(menu::build)
        // Menu items carry the command id the frontend understands; predefined
        // items (copy/paste/quit…) are handled natively and never reach here.
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-command", event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_metadata,
            commands::read_metadata_batch,
            commands::write_metadata,
            commands::save_metadata,
            commands::bulk_save_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
