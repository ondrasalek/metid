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

    #[error("Sidecar binary not found: {0}")]
    SidecarNotFound(String),

    #[error("Failed to execute sidecar: {0}")]
    ExecutionFailed(String),

    #[error("Sidecar reported an error: {0}")]
    ToolError(String),

    #[error("Failed to parse ExifTool output: {0}")]
    ParseError(String),

    #[error("Invalid tag name: {0}")]
    InvalidTag(String),

    #[error("Invalid value for tag {0}: newline characters are not allowed")]
    InvalidValue(String),

    #[allow(dead_code)] // reserved for formats with no write sidecar yet
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

// ── Sidecar discovery ─────────────────────────────────────────────────────────
//
// Tier 1 — Production bundle (externalBin in tauri.conf.json):
//   Tauri strips both the subdirectory prefix AND the platform triple suffix
//   when bundling, so the binary lives as plain "exiftool" next to the app exe:
//   App.app/Contents/MacOS/metid  →  …/Contents/MacOS/exiftool
//
// Tier 2 — Dev build (build.rs copies with triple suffix):
//   target/debug/metid  →  target/debug/exiftool-aarch64-apple-darwin
//
// Tier 3 — Fallback before build.rs has run:
//   Checks CARGO_MANIFEST_DIR (src-tauri/) for the triple-suffixed name.
//
// Tier 4 — System PATH / well-known Homebrew prefixes (dev convenience):
//   Allows a tool like mkvpropedit to be used in development straight from
//   `brew install mkvtoolnix` without a symlink in src-tauri/ or an
//   externalBin entry.  Production builds must use Tiers 1–3 (the binary
//   must be added to externalBin and placed in src-tauri/).
//
// Works for any sidecar — pass "exiftool", "mkvpropedit", etc.
fn find_sidecar(name: &str) -> Result<PathBuf, ExifError> {
    let exe = std::env::current_exe()
        .map_err(|e| ExifError::SidecarNotFound(e.to_string()))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| ExifError::SidecarNotFound("exe has no parent directory".into()))?;

    // Tier 1: Production bundle — plain name, no triple
    let bundled_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let bundled = exe_dir.join(&bundled_name);
    if bundled.exists() {
        return Ok(bundled);
    }

    // Tier 2: Dev build — triple-suffixed copy produced by build.rs
    let stem = format!("{name}-{}", env!("TAURI_ENV_TARGET_TRIPLE"));
    let dev_name = if cfg!(windows) {
        format!("{stem}.exe")
    } else {
        stem
    };
    let dev = exe_dir.join(&dev_name);
    if dev.exists() {
        return Ok(dev);
    }

    // Tier 3: Direct `cargo run` before build.rs copies the binary
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let source = PathBuf::from(manifest).join(&dev_name);
        if source.exists() {
            return Ok(source);
        }
    }

    // Tier 4: System installation (dev convenience — not used in prod bundles).
    // Check common Homebrew prefixes first (avoids spawning a subprocess).
    if cfg!(unix) {
        for prefix in &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            let p = PathBuf::from(prefix).join(name);
            if p.exists() {
                return Ok(p);
            }
        }
    }
    // Last resort: ask the shell where the binary is.
    #[cfg(unix)]
    if let Ok(out) = std::process::Command::new("which").arg(name).output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Ok(PathBuf::from(s));
            }
        }
    }

    Err(ExifError::SidecarNotFound(format!(
        "{name}: not found next to executable ({bundled:?}), in PATH, or in common system locations"
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

// ── Read ──────────────────────────────────────────────────────────────────────

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

    let sidecar = find_sidecar("exiftool")?;
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

// ── Write (single-file, used by the write_metadata command) ──────────────────

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

    preflight_write(&canonical)?;

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

    let sidecar = find_sidecar("exiftool")?;
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

// ── MKV / WebM write via mkvpropedit ─────────────────────────────────────────

/// Write metadata to an MKV or WebM file using `mkvpropedit`.
///
/// Only tags with a known mkvpropedit equivalent are written; all others are
/// silently ignored.  If no recognised tags are present, returns `Ok(())` immediately
/// without spawning the sidecar.
///
/// Arguments are passed as a `Vec<String>` to `std::process::Command` — no shell
/// is involved, so spaces and special characters in values are handled verbatim
/// and securely without any quoting.
///
/// `keep_backups` is accepted for API symmetry but has no effect: `mkvpropedit`
/// always modifies the container in-place and provides no backup option.
pub async fn save_mkv_metadata(
    file_path: &str,
    updates: &HashMap<String, String>,
    _keep_backups: bool,
) -> Result<(), ExifError> {
    let p = Path::new(file_path);
    if !p.exists() {
        return Err(ExifError::FileNotFound(file_path.to_string()));
    }
    if !p.is_file() {
        return Err(ExifError::NotAFile(file_path.to_string()));
    }

    // Build edit arguments, skipping any tag that mkvpropedit doesn't support.
    // Strip group prefix first: "XMP-dc:Title" → "title", "Title" → "title".
    let mut edit_args: Vec<String> = Vec::new();
    for (tag, value) in updates {
        let short = tag.rsplit(':').next().unwrap_or(tag).to_lowercase();
        match short.as_str() {
            "title" => {
                edit_args.push("--edit".into());
                edit_args.push("info".into());
                edit_args.push("--set".into());
                edit_args.push(format!("title={value}"));
            }
            _ => continue, // unsupported — silently skip
        }
    }

    if edit_args.is_empty() {
        return Ok(()); // nothing to write
    }

    let canonical = p
        .canonicalize()
        .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
    let canonical_str = canonical.to_str().ok_or(ExifError::InvalidPath)?.to_owned();

    preflight_write(&canonical)?;

    let mut args: Vec<String> = vec![canonical_str];
    args.extend(edit_args);

    let sidecar = find_sidecar("mkvpropedit")?;

    let output = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new(&sidecar).args(&args).output()
    })
    .await
    .map_err(|e| ExifError::ExecutionFailed(format!("task join: {e}")))?
    .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;

    if !output.status.success() {
        // mkvpropedit writes diagnostics to stdout, not stderr.
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("mkvpropedit exit {:?}", output.status.code())
        };
        return Err(ExifError::ToolError(msg));
    }

    Ok(())
}

// ── Multi-file save (routes by format) ───────────────────────────────────────

pub async fn save_metadata(
    app: &AppHandle,
    file_paths: Vec<String>,
    updates: HashMap<String, String>,
    keep_backups: bool,
) -> Result<(), ExifError> {
    if file_paths.is_empty() || updates.is_empty() {
        return Ok(());
    }

    // Validate all tags and values upfront (applies regardless of format).
    for (tag, value) in &updates {
        if !is_valid_tag(tag) {
            return Err(ExifError::InvalidTag(tag.clone()));
        }
        if value.contains('\n') || value.contains('\r') {
            return Err(ExifError::InvalidValue(tag.clone()));
        }
    }

    // ── Route by format ───────────────────────────────────────────────────────
    //
    // MKV / WebM → mkvpropedit (one invocation per file; handles its own path checks).
    // Everything else → ExifTool (all files in a single argfile call).
    //
    // bulk_save_metadata always passes one file at a time, so in practice the
    // partition always has exactly one side populated. Mixed batches sent via
    // the raw save_metadata command are handled correctly too.
    let (mkv_paths, exiftool_paths): (Vec<_>, Vec<_>) =
        file_paths.iter().partition(|fp| is_mkv_format(fp));

    for fp in &mkv_paths {
        save_mkv_metadata(fp, &updates, keep_backups).await?;
    }

    if exiftool_paths.is_empty() {
        return Ok(());
    }

    // ── ExifTool path ─────────────────────────────────────────────────────────
    let mut canonicals: Vec<String> = Vec::with_capacity(exiftool_paths.len());
    for fp in &exiftool_paths {
        let path = Path::new(fp.as_str());
        if !path.exists() {
            return Err(ExifError::FileNotFound(fp.to_string()));
        }
        if !path.is_file() {
            return Err(ExifError::NotAFile(fp.to_string()));
        }
        let c = path
            .canonicalize()
            .map_err(|e| ExifError::ExecutionFailed(e.to_string()))?;
        // Pre-flight every file. Fails fast with the real OS errno before
        // ExifTool runs, so a permission issue on file 3 of 50 doesn't
        // produce a confusing partial-write error from a single ExifTool
        // invocation that processes the whole batch.
        preflight_write(&c)?;
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
    let sidecar = find_sidecar("exiftool")?;
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

// ── Bulk per-file save ────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Open the file briefly with `O_RDWR` and immediately drop the handle.
///
/// Purpose: surface the *real* OS errno when a write is blocked, before any
/// sidecar process is spawned. Without this, the underlying tool reports a
/// generic "cannot open for writing" / "permission denied" message that hides
/// which of TCC denial, read-only mount, immutable flag, or POSIX deny is
/// actually at fault.
///
/// We use `O_RDWR` rather than `O_WRONLY` for two reasons:
///   1. **mkvpropedit and ExifTool both open with `O_RDWR`** internally —
///      they need to seek-write inside the file. Aligning the pre-flight
///      with what the tool actually does avoids false positives where the
///      pre-flight passes but the tool fails (or vice versa).
///   2. **Some macOS-side filters and SMB servers** are stricter about
///      `O_WRONLY` than `O_RDWR`. Apple's SMB client has been observed
///      to reject `O_WRONLY` opens that an `O_RDWR` open would handle.
///
/// On failure, we shell out to `xattr -l` (macOS only) to log the file's
/// extended attributes to stderr — a read-only diagnostic so we can see
/// whether `com.apple.quarantine`, `com.apple.rootless`, or `com.apple.FinderInfo`
/// flags are actually involved without modifying anything.
///
/// Applies to every write path (mkvpropedit and ExifTool, single-file and
/// batch). The `File` is dropped explicitly via the `drop()` call so the FD
/// is closed before the sidecar process is spawned.
fn preflight_write(canonical: &Path) -> Result<(), ExifError> {
    match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(canonical)
    {
        Ok(file) => {
            // Explicit drop documents intent: FD must be closed before any
            // sidecar runs. (Rust would drop at function return anyway.)
            drop(file);
            Ok(())
        }
        Err(e) => {
            log_xattrs_diagnostic(canonical);
            Err(ExifError::ToolError(format!(
                "Cannot open file for writing: {e}. \
                 If the file is on a network or removable volume, grant access via \
                 System Settings → Privacy & Security → Files and Folders. \
                 Extended attributes have been logged to the console for diagnostics."
            )))
        }
    }
}

/// Read-only diagnostic: logs the file's extended attributes to stderr.
///
/// Called from `preflight_write` when the pre-flight open fails so we can
/// see whether xattrs (`com.apple.quarantine`, `com.apple.rootless`,
/// `com.apple.FinderInfo`, etc.) are involved in the failure. Does NOT
/// modify the file in any way — this is `xattr -l` (list), not `xattr -c`
/// (clear) or `xattr -d` (delete).
///
/// Output goes to stderr and shows up:
///   - In dev (`npm run tauri dev`): the terminal where dev is running.
///   - In a built bundle: `log stream --process metid` (or Console.app).
///
/// Best-effort: failures to invoke `xattr` are themselves logged and do
/// not propagate.
#[cfg(target_os = "macos")]
fn log_xattrs_diagnostic(path: &Path) {
    let result = std::process::Command::new("xattr").arg("-l").arg(path).output();
    match result {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            eprintln!("[metid xattr-diag] file: {}", path.display());
            if stdout.trim().is_empty() {
                eprintln!("[metid xattr-diag] no extended attributes");
            } else {
                eprintln!("[metid xattr-diag] xattrs:\n{}", stdout.trim_end());
            }
            if !stderr.trim().is_empty() {
                eprintln!("[metid xattr-diag] xattr stderr: {}", stderr.trim_end());
            }
        }
        Err(e) => {
            eprintln!(
                "[metid xattr-diag] failed to invoke `xattr -l` on {}: {}",
                path.display(),
                e
            );
        }
    }
}

/// No-op stub on non-macOS targets. Extended attributes are a Darwin
/// concept; Linux uses a different `xattr(7)` namespace and Windows has
/// alternate streams which aren't related to this diagnostic.
#[cfg(not(target_os = "macos"))]
fn log_xattrs_diagnostic(_path: &Path) {}

fn is_valid_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 128
        && tag
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-'))
}

/// Returns true for MKV/WebM container files, which ExifTool can read but not
/// write. These are routed to `mkvpropedit` instead.
fn is_mkv_format(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    matches!(ext.as_str(), "mkv" | "webm")
}
