use std::collections::HashMap;
use tauri::AppHandle;

use crate::exiftool::{self, ExifError};

#[tauri::command]
pub async fn read_metadata(
    app: AppHandle,
    file_path: String,
) -> Result<serde_json::Value, ExifError> {
    exiftool::read_metadata(&app, &file_path).await
}

#[tauri::command]
pub async fn read_metadata_batch(
    app: AppHandle,
    file_paths: Vec<String>,
) -> Vec<exiftool::BatchReadItem> {
    exiftool::read_metadata_batch(&app, file_paths).await
}

#[tauri::command]
pub async fn write_metadata(
    app: AppHandle,
    file_path: String,
    tags: HashMap<String, String>,
    keep_backups: bool,
) -> Result<(), ExifError> {
    exiftool::write_metadata(&app, &file_path, tags, keep_backups).await
}

#[tauri::command]
pub async fn save_metadata(
    app: AppHandle,
    file_paths: Vec<String>,
    updates: HashMap<String, String>,
    keep_backups: bool,
) -> Result<(), ExifError> {
    exiftool::save_metadata(&app, file_paths, updates, keep_backups).await
}

#[tauri::command]
pub async fn bulk_save_metadata(
    app: AppHandle,
    file_updates: Vec<exiftool::FileUpdate>,
    keep_backups: bool,
) -> Vec<exiftool::BulkSaveResult> {
    exiftool::bulk_save_metadata(&app, file_updates, keep_backups).await
}
