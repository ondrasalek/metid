import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  ALL_SUPPORTED_EXT,
  IMAGE_EXT,
  VIDEO_EXT,
  AUDIO_EXT,
  DOC_EXT,
} from "../constants";

export type Metadata = Record<string, unknown>;
export type MetadataUpdates = Record<string, string>;
export type ExifError = { kind: string; message: string };
export type BatchItem = {
  file_path: string;
  metadata: Metadata | null;
  error: ExifError | null;
};
export type FileUpdate = { path: string; updates: MetadataUpdates };
export type BulkSaveResult = { path: string; ok: boolean; error: ExifError | null };

// Open-file dialog filters. "All Supported" leads, then per-category lists for
// users who want to narrow down, then "All Files" as the escape hatch for any
// extension ExifTool can read but we haven't enumerated.
export const DIALOG_FILTERS = [
  { name: "All Supported", extensions: ALL_SUPPORTED_EXT },
  { name: "Images", extensions: IMAGE_EXT },
  { name: "Videos", extensions: VIDEO_EXT },
  { name: "Audio", extensions: AUDIO_EXT },
  { name: "Documents", extensions: DOC_EXT },
  { name: "All Files", extensions: ["*"] },
];

const READ_ONLY_GROUPS = new Set(["File", "Composite", "ExifTool", "SourceFile", "System"]);

export function groupOf(tag: string): string {
  const i = tag.indexOf(":");
  return i < 0 ? tag : tag.slice(0, i);
}

export function shortName(tag: string): string {
  const i = tag.indexOf(":");
  return i < 0 ? tag : tag.slice(i + 1);
}

export function isWritable(tag: string): boolean {
  return !READ_ONLY_GROUPS.has(groupOf(tag));
}

export function isReadOnlyGroup(group: string): boolean {
  return READ_ONLY_GROUPS.has(group);
}

export function saveFilesMetadata(
  filePaths: string[],
  updates: MetadataUpdates,
  keepBackups: boolean,
): Promise<void> {
  return invoke("save_metadata", { filePaths, updates, keepBackups });
}

export function containsTemplate(value: string): boolean {
  return /\{[^}]+\}/.test(value);
}

// Native confirmation shown before an action would silently throw away unsaved
// edits (switching mode, opening other files, quitting). Resolves true when the
// user chooses to discard.
export async function confirmDiscard(message: string): Promise<boolean> {
  return confirm(message, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Keep editing",
  });
}

export function resolveVariables(template: string, filePath: string): string {
  const full = basename(filePath);
  const dotIdx = full.lastIndexOf(".");
  const filename = dotIdx >= 0 ? full.slice(0, dotIdx) : full;
  const ext = dotIdx >= 0 ? full.slice(dotIdx + 1) : "";

  // {filename|match:<pattern>} — regex extraction, more specific so runs first.
  // If the pattern has a capture group, returns group 1; otherwise the full match.
  // Returns "" on no match or invalid regex (safer than writing a literal template string).
  const result = template.replace(/\{filename\|match:([^}]+)\}/gi, (_, pattern) => {
    try {
      const m = new RegExp(pattern).exec(filename);
      if (!m) return "";
      return m[1] !== undefined ? m[1] : m[0];
    } catch {
      return "";
    }
  });

  return result.replace(/\{filename\}/gi, filename).replace(/\{ext\}/gi, ext);
}

// Natural sort by filename only: "E02" < "E11", case-insensitive.
// Comparing basenames instead of full paths avoids the numeric collator
// picking up unrelated numbers earlier in the path (drive letters, dates, etc.).
export function naturalSortPaths(a: string, b: string): number {
  return basename(a).localeCompare(basename(b), undefined, { numeric: true, sensitivity: "base" });
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : "";
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ExifTool returns fully-qualified keys ("EXIF:Artist", "XMP:Title"). Column names
// from COMMON_TAGS are short ("Artist", "Title"). Try exact match first, then suffix.
export function findMetadataValue(metadata: Metadata | null, tag: string): unknown {
  if (!metadata) return undefined;
  if (tag in metadata) return metadata[tag];
  const suffix = `:${tag}`;
  const key = Object.keys(metadata).find((k) => k.endsWith(suffix));
  return key ? metadata[key] : undefined;
}

export function errorOf(e: unknown): ExifError {
  if (e && typeof e === "object" && "message" in e) return e as ExifError;
  return { kind: "Error", message: String(e) };
}
