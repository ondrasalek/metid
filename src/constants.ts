// ── File-type categorization ─────────────────────────────────────────────────
//
// One small taxonomy used in two places:
//   1) The OS open-file dialog filters — grouped extension lists below.
//   2) The "Add Tag" picker — tags carry a `formats?` field that filters them
//      against the currently open file's category.

export type TagFormat = "image" | "video" | "audio" | "document";

// Per-category extension lists. Lowercase, no leading dot.
//
// Coverage notes:
//   - IMAGE_EXT covers common photo formats plus the major raw formats ExifTool
//     supports (Canon CR2/CR3, Nikon NEF/NRW, Sony ARW/SRW, Adobe DNG, Fuji
//     RAF, Olympus ORF, Pentax PEF, Panasonic RW2/RWL, Sigma X3F).
//   - VIDEO_EXT skips obscure container formats; mkvpropedit handles MKV/WEBM,
//     ExifTool handles the rest (with varying tag-write coverage).
//   - AUDIO_EXT covers losy + lossless mainstream formats.
//   - DOC_EXT covers what ExifTool can read; .txt / .md have no internal
//     metadata container — only filesystem dates are writable, which our
//     UI currently treats as read-only. Open them anyway for inspection.
export const IMAGE_EXT = [
  "jpg", "jpeg", "png", "tif", "tiff", "gif", "bmp", "webp", "heic", "heif",
  "svg", "ico", "psd",
  "cr2", "cr3", "nef", "nrw", "arw", "srw", "dng", "raf", "orf", "pef",
  "rw2", "rwl", "x3f",
];

export const VIDEO_EXT = [
  "mp4", "mov", "avi", "mkv", "m4v", "webm", "wmv", "mpg", "mpeg", "flv",
  "3gp", "ts", "mts",
];

export const AUDIO_EXT = [
  "mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "wma", "aiff", "ape",
  "alac",
];

export const DOC_EXT = [
  "pdf", "txt", "md", "rtf", "docx", "xlsx", "pptx", "epub",
];

/**
 * Plain-text formats with no internal metadata container. Reading via
 * ExifTool returns only filesystem-level info (size, mtime, MIME type) and
 * any attempt to write internal tags (Title, Author, etc.) returns
 * `ToolError: exit Some(1)` from ExifTool. The UI uses this list to gate
 * Save/Add-Tag for these formats.
 *
 * Note: PDF, DOCX, XLSX, PPTX, EPUB all DO have internal metadata and are
 * intentionally excluded — they remain fully editable.
 */
export const PLAIN_TEXT_EXT = ["txt", "md", "rtf"];

/**
 * True when the file format supports writing internal metadata tags.
 * Returns `true` by default for unknown extensions so the user can still
 * try (the backend will surface a clear error if the format truly has
 * no writable tags).
 */
export function hasWritableMetadata(path: string): boolean {
  const i = path.lastIndexOf(".");
  if (i < 0) return true;
  return !PLAIN_TEXT_EXT.includes(path.slice(i + 1).toLowerCase());
}

// Combined list — what we pass when the user wants the broad default filter.
export const ALL_SUPPORTED_EXT = [
  ...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT, ...DOC_EXT,
];

/**
 * Maps a file path to its broad metadata category. Returns `null` for
 * extensions outside our four categories — the UI treats these as "show only
 * universally-applicable tags" in the picker.
 */
export function categorizeFile(path: string): TagFormat | null {
  const i = path.lastIndexOf(".");
  if (i < 0) return null;
  const ext = path.slice(i + 1).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (DOC_EXT.includes(ext)) return "document";
  return null;
}

// ── Common tag suggestions ───────────────────────────────────────────────────
//
// Each tag may declare which categories it applies to via `formats`. A tag
// with no `formats` field is treated as universal and shown for every file.
//
// The picker filters this list against the current file's category — e.g.
// opening an MP3 hides "Director" but shows "Album" / "Genre" / "Artist".
//
// The `name` is the bare tag name passed to the writer; ExifTool / mkvpropedit
// resolve it against the right group automatically (XMP, EXIF, ID3, etc.).
export type CommonTag = {
  name: string;
  hint: string;
  formats?: TagFormat[];
};

export const COMMON_TAGS: CommonTag[] = [
  { name: "Title",       hint: "Title or name" },
  { name: "Description", hint: "Caption / description" },
  { name: "Comment",     hint: "Free-form comment" },
  { name: "Copyright",   hint: "Copyright notice" },
  { name: "Author",      hint: "Author" },
  { name: "Creator",     hint: "Creator" },
  { name: "Subject",     hint: "Subject" },

  { name: "Artist",      hint: "Photographer or creator", formats: ["image", "audio", "video"] },
  { name: "Keywords",    hint: "Comma-separated keywords", formats: ["image", "video", "audio", "document"] },
  { name: "Rating",      hint: "Star rating (0–5)",        formats: ["image", "video", "audio"] },

  { name: "Album",       hint: "Album",                     formats: ["audio"] },
  { name: "Genre",       hint: "Genre",                     formats: ["audio", "video"] },
  { name: "Year",        hint: "Year",                      formats: ["audio", "video"] },
  { name: "Director",    hint: "Director",                  formats: ["video"] },
];
