use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ExifError {
    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Path is not a regular file: {0}")]
    NotAFile(String),

    #[error("Path contains invalid UTF-8")]
    InvalidPath,

    #[error("ExifTool binary not found: {0}")]
    SidecarNotFound(String),

    #[error("Failed to execute ExifTool: {0}")]
    ExecutionFailed(String),

    #[error("ExifTool reported an error: {0}")]
    ToolError(String),

    #[error("Failed to parse ExifTool output: {0}")]
    ParseError(String),

    #[error("Invalid tag name: {0}")]
    InvalidTag(String),

    #[error("Invalid value for tag {0}: newline characters are not allowed")]
    InvalidValue(String),

    #[error("Writing not supported for this format: {0}")]
    UnsupportedFormat(String),
}

impl serde::Serialize for ExifError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let kind = match self {
            ExifError::FileNotFound(_) => "FileNotFound",
            ExifError::NotAFile(_) => "NotAFile",
            ExifError::InvalidPath => "InvalidPath",
            ExifError::SidecarNotFound(_) => "SidecarNotFound",
            ExifError::ExecutionFailed(_) => "ExecutionFailed",
            ExifError::ToolError(_) => "ToolError",
            ExifError::ParseError(_) => "ParseError",
            ExifError::InvalidTag(_) => "InvalidTag",
            ExifError::InvalidValue(_) => "InvalidValue",
            ExifError::UnsupportedFormat(_) => "UnsupportedFormat",
        };
        let mut st = s.serialize_struct("ExifError", 2)?;
        st.serialize_field("kind", kind)?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

#[derive(Debug, serde::Serialize)]
pub struct BatchReadItem {
    pub file_path: String,
    pub metadata: Option<serde_json::Value>,
    pub error: Option<ExifError>,
}

// Locate the exiftool sidecar relative to the current executable.
//
// Tauri bundles externalBin entries next to the main executable AND strips
// the platform triple suffix, so the prod bundle contains plain "exiftool":
//   Prod: App.app/Contents/MacOS/metid  →  …/Contents/MacOS/exiftool
//
// build.rs copies with the triple name for dev runs:
//   Dev:  target/debug/metid  →  target/debug/exiftool-<triple>
fn find_sidecar() -> Result<PathBuf, ExifError> {
    let exe = std::env::current_exe()
        .map_err(|e| ExifError::SidecarNotFound(e.to_string()))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| ExifError::SidecarNotFound("exe has no parent directory".into()))?;

    // 1. Production bundle: plain name, no triple (Tauri strips it at bundle time)
    let bundled_name = if cfg!(windows) { "exiftool.exe" } else { "exiftool" };
    let bundled = exe_dir.join(bundled_name);
    if bundled.exists() {
        return Ok(bundled);
    }

    // 2. Dev build: build.rs copies with the triple suffix into target/{profile}/
    let stem = format!("exiftool-{}", env!("TAURI_ENV_TARGET_TRIPLE"));
    let dev_name = if cfg!(windows) { format!("{stem}.exe") } else { stem };
    let dev = exe_dir.join(&dev_name);
    if dev.exists() {
        return Ok(dev);
    }

    // 3. Direct `cargo run` before build.rs has run: check src-tauri root
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let source = PathBuf::from(manifest).join(&dev_name);
        if source.exists() {
            return Ok(source);
        }
    }

    Err(ExifError::SidecarNotFound(format!(
        "Expected at {bundled:?} or {dev:?}"
    )))
}

// Resolve the bundled Perl lib directory for PERL5LIB.
fn perl5lib(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve(
            "resources/exiftool/lib",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()
}

pub async fn read_metadata(
    app: &AppHandle,
    file_path: &str,
) -> Result<serde_json::Value, ExifError> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(ExifError::FileNotFound(file_path.to_string()));
    }
    if !path.is_file() {
        return Err(ExifError::NotAFile(file_path.to_string()));
    }

    let canonical = path
        .canonicalize()
        .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
    let canonical_str = canonical
        .to_str()
        .ok_or(ExifError::InvalidPath)?
        .to_owned();

    let sidecar = find_sidecar()?;
    let lib = perl5lib(app);

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&sidecar);
        cmd.args(["-j", "-G", "-n", "--", &canonical_str]);
        if let Some(l) = lib {
            cmd.env("PERL5LIB", l);
        }
        cmd.output()
    })
    .await
    .map_err(|e| ExifError::ExecutionFailed(format!("task join: {e}")))?
    .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(ExifError::ToolError(if stderr.is_empty() {
            format!("exit {:?}", output.status.code())
        } else {
            stderr
        }));
    }

    let stdout =
        std::str::from_utf8(&output.stdout).map_err(|e| ExifError::ParseError(e.to_string()))?;

    let mut values: Vec<serde_json::Value> =
        serde_json::from_str(stdout).map_err(|e| ExifError::ParseError(e.to_string()))?;

    values
        .pop()
        .ok_or_else(|| ExifError::ParseError("Empty response from ExifTool".into()))
}

pub async fn read_metadata_batch(app: &AppHandle, file_paths: Vec<String>) -> Vec<BatchReadItem> {
    let handles: Vec<_> = file_paths
        .into_iter()
        .map(|path| {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                match read_metadata(&app, &path).await {
                    Ok(metadata) => BatchReadItem {
                        file_path: path,
                        metadata: Some(metadata),
                        error: None,
                    },
                    Err(e) => BatchReadItem {
                        file_path: path,
                        metadata: None,
                        error: Some(e),
                    },
                }
            })
        })
        .collect();

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(item) = handle.await {
            results.push(item);
        }
    }
    results
}

pub async fn write_metadata(
    app: &AppHandle,
    file_path: &str,
    tags: HashMap<String, String>,
    keep_backups: bool,
) -> Result<(), ExifError> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(ExifError::FileNotFound(file_path.to_string()));
    }
    if !path.is_file() {
        return Err(ExifError::NotAFile(file_path.to_string()));
    }
    if tags.is_empty() {
        return Ok(());
    }

    for (tag, value) in &tags {
        if !is_valid_tag(tag) {
            return Err(ExifError::InvalidTag(tag.clone()));
        }
        if value.contains('\n') || value.contains('\r') {
            return Err(ExifError::InvalidValue(tag.clone()));
        }
    }

    let canonical = path
        .canonicalize()
        .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
    let canonical_str = canonical
        .to_str()
        .ok_or(ExifError::InvalidPath)?
        .to_owned();

    let mut argfile =
        tempfile::NamedTempFile::new().map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
    for (tag, value) in &tags {
        writeln!(argfile, "-{}={}", tag, value)
            .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
    }
    argfile
        .flush()
        .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
    let argfile_path = argfile
        .path()
        .to_str()
        .ok_or(ExifError::InvalidPath)?
        .to_owned();

    let sidecar = find_sidecar()?;
    let lib = perl5lib(app);

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&sidecar);
        if !keep_backups {
            cmd.arg("-overwrite_original");
        }
        cmd.args(["-@", &argfile_path, "--", &canonical_str]);
        if let Some(l) = lib {
            cmd.env("PERL5LIB", l);
        }
        let result = cmd.output();
        drop(argfile); // keep temp file alive until process exits
        result
    })
    .await
    .map_err(|e| ExifError::ExecutionFailed(format!("task join: {e}")))?
    .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(ExifError::ToolError(if stderr.is_empty() {
            format!("exit {:?}", output.status.code())
        } else {
            stderr
        }));
    }
    Ok(())
}

pub async fn save_metadata(
    app: &AppHandle,
    file_paths: Vec<String>,
    updates: HashMap<String, String>,
    keep_backups: bool,
) -> Result<(), ExifError> {
    if file_paths.is_empty() || updates.is_empty() {
        return Ok(());
    }

    // Reject formats ExifTool cannot write. MKV/WebM support is pending
    // mkvpropedit integration; fail early with a clear message instead of
    // letting ExifTool produce a cryptic "Writing not supported" error.
    for fp in &file_paths {
        if is_exiftool_write_unsupported(fp) {
            let ext = Path::new(fp)
                .extension()
                .map(|e| e.to_string_lossy().to_uppercase())
                .unwrap_or_default();
            return Err(ExifError::UnsupportedFormat(format!(
                "{ext} writing is not yet supported (mkvpropedit integration pending)"
            )));
        }
    }

    for (tag, value) in &updates {
        if !is_valid_tag(tag) {
            return Err(ExifError::InvalidTag(tag.clone()));
        }
        if value.contains('\n') || value.contains('\r') {
            return Err(ExifError::InvalidValue(tag.clone()));
        }
    }

    let mut canonicals: Vec<String> = Vec::with_capacity(file_paths.len());
    for fp in &file_paths {
        let path = Path::new(fp);
        if !path.exists() {
            return Err(ExifError::FileNotFound(fp.clone()));
        }
        if !path.is_file() {
            return Err(ExifError::NotAFile(fp.clone()));
        }
        let c = path
            .canonicalize()
            .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
        canonicals.push(c.to_str().ok_or(ExifError::InvalidPath)?.to_owned());
    }

    let mut argfile =
        tempfile::NamedTempFile::new().map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
    for (tag, value) in &updates {
        writeln!(argfile, "-{}={}", tag, value)
            .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
    }
    writeln!(argfile, "--").map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
    for c in &canonicals {
        writeln!(argfile, "{}", c)
            .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
    }
    argfile
        .flush()
        .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;

    let argfile_path = argfile
        .path()
        .to_str()
        .ok_or(ExifError::InvalidPath)?
        .to_owned();
    let sidecar = find_sidecar()?;
    let lib = perl5lib(app);

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&sidecar);
        if !keep_backups {
            cmd.arg("-overwrite_original");
        }
        cmd.args(["-@", &argfile_path]);
        if let Some(l) = lib {
            cmd.env("PERL5LIB", l);
        }
        let result = cmd.output();
        drop(argfile);
        result
    })
    .await
    .map_err(|e| ExifError::ExecutionFailed(format!("task join: {e}")))?
    .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(ExifError::ToolError(if stderr.is_empty() {
            format!("exit {:?}", output.status.code())
        } else {
            stderr
        }));
    }
    Ok(())
}

// ── Bulk per-file save ────────────────────────────────────────────────────

/// One file's worth of tag updates, as received from the frontend after
/// variable resolution has already produced the final per-file values.
#[derive(Debug, serde::Deserialize)]
pub struct FileUpdate {
    pub path: String,
    pub updates: HashMap<String, String>,
}

/// Per-file outcome returned to the frontend after a bulk save.
#[derive(Debug, serde::Serialize)]
pub struct BulkSaveResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<ExifError>,
}

pub async fn bulk_save_metadata(
    app: &AppHandle,
    file_updates: Vec<FileUpdate>,
    keep_backups: bool,
) -> Vec<BulkSaveResult> {
    let mut results = Vec::with_capacity(file_updates.len());
    for fu in file_updates {
        let res = save_metadata(app, vec![fu.path.clone()], fu.updates, keep_backups).await;
        results.push(BulkSaveResult {
            ok: res.is_ok(),
            error: res.err(),
            path: fu.path,
        });
    }
    results
}

fn is_valid_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 128
        && tag
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-'))
}

/// Returns true for container formats that ExifTool can read but not write.
/// These are routed to format-specific sidecars (e.g. mkvpropedit) once integrated.
fn is_exiftool_write_unsupported(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    matches!(ext.as_str(), "mkv" | "webm")
}
