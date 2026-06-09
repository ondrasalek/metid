mod commands;
mod exiftool;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
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
