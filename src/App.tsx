import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Toaster, toast } from "sonner";
import {
  FileIcon, FileImage, Settings, Grid, Trash2,
  Lock, Plus, Search, Folder, Save, AlertCircle, X, RotateCcw
} from "lucide-react";
import "./App.css";
import {
  COMMON_TAGS,
  ALL_SUPPORTED_EXT,
  IMAGE_EXT,
  VIDEO_EXT,
  AUDIO_EXT,
  DOC_EXT,
  categorizeFile,
  hasWritableMetadata,
} from "./constants";
import { useSettings } from "./hooks/useSettings";
import { useCmdKey, MOD_LABEL } from "./hooks/useHotkeys";
import { useApplyTheme, resolveTheme, ResolvedTheme } from "./hooks/useTheme";
import { SettingsView } from "./components/SettingsView";

type Metadata = Record<string, unknown>;
type MetadataUpdates = Record<string, string>;
type ExifError = { kind: string; message: string };
type BatchItem = {
  file_path: string;
  metadata: Metadata | null;
  error: ExifError | null;
};

type FileUpdate = { path: string; updates: MetadataUpdates };
type BulkSaveResult = { path: string; ok: boolean; error: ExifError | null };

type Mode = "single" | "batch" | "settings";

// Open-file dialog filters. "All Supported" leads, then per-category lists for
// users who want to narrow down, then "All Files" as the escape hatch for any
// extension ExifTool can read but we haven't enumerated.
const DIALOG_FILTERS = [
  { name: "All Supported", extensions: ALL_SUPPORTED_EXT },
  { name: "Images",        extensions: IMAGE_EXT },
  { name: "Videos",        extensions: VIDEO_EXT },
  { name: "Audio",         extensions: AUDIO_EXT },
  { name: "Documents",     extensions: DOC_EXT },
  { name: "All Files",     extensions: ["*"] },
];

const READ_ONLY_GROUPS = new Set([
  "File",
  "Composite",
  "ExifTool",
  "SourceFile",
  "System",
]);

function isWritable(tag: string): boolean {
  const i = tag.indexOf(":");
  if (i < 0) return !READ_ONLY_GROUPS.has(tag);
  return !READ_ONLY_GROUPS.has(tag.slice(0, i));
}

async function saveFilesMetadata(
  filePaths: string[],
  updates: MetadataUpdates,
  keepBackups: boolean,
): Promise<void> {
  return invoke("save_metadata", { filePaths, updates, keepBackups });
}

function containsTemplate(value: string): boolean {
  return /\{[^}]+\}/.test(value);
}

// Native confirmation shown before an action would silently throw away unsaved
// edits (switching mode, opening other files, quitting). Resolves true when the
// user chooses to discard.
async function confirmDiscard(message: string): Promise<boolean> {
  return confirm(message, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Keep editing",
  });
}

function resolveVariables(template: string, filePath: string): string {
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

  return result
    .replace(/\{filename\}/gi, filename)
    .replace(/\{ext\}/gi, ext);
}

export default function App() {
  const [mode, setMode] = useState<Mode>("single");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pendingDropPaths, setPendingDropPaths] = useState<string[] | null>(null);
  const { settings, updateSettings } = useSettings();
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(settings.theme),
  );
  useApplyTheme(settings.theme, setResolvedTheme);

  // Unsaved-edit tracking, lifted out of the views so the sidebar and the
  // window-close handler can guard against silent data loss. The ref mirrors
  // the state for the close listener, which is registered once.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  async function switchMode(next: Mode) {
    if (next === mode) return;
    if (dirty && !(await confirmDiscard("Switching views will discard your unsaved changes."))) {
      return;
    }
    setMode(next);
  }

  // Intercept the OS close request while edits are pending. WebviewWindow
  // surfaces onCloseRequested; we preventDefault and re-issue the close only
  // after the user confirms.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const win = getCurrentWebviewWindow();
    win
      .onCloseRequested(async (event) => {
        if (!dirtyRef.current) return;
        event.preventDefault();
        if (await confirmDiscard("You have unsaved changes. Quit anyway?")) {
          unlisten?.();
          await win.destroy();
        }
      })
      .then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebviewWindow()
      .onDragDropEvent((e) => {
        if (e.payload.type === "over") {
          setIsDraggingOver(true);
        } else if (e.payload.type === "drop") {
          setIsDraggingOver(false);
          if (e.payload.paths.length > 0) setPendingDropPaths(e.payload.paths);
        } else {
          // "leave" or anything else
          setIsDraggingOver(false);
        }
      })
      .then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-transparent text-fg font-sans selection:bg-blue-500/30">
      <Toaster theme={resolvedTheme} position="bottom-right" className="font-sans" />

      {/* Full-width drag region — absolutely positioned over the top of the window so it covers the
          native macOS traffic light area while the sidebar and main panel extend behind it. */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-10 z-30" />

      {/* Sidebar — translucent glass panel.
          - bg-app/40 + backdrop-blur-2xl + backdrop-saturate-[180%] lets the
            desktop wallpaper bleed through with vibrancy (works because the window
            itself has `transparent: true` in tauri.conf.json).
          - The right-edge inset shadow simulates depth where the panel meets the
            main content area. */}
      <aside className="w-16 flex-shrink-0 flex flex-col items-center bg-app/60 backdrop-blur-2xl backdrop-saturate-[180%] border-r border-ovl/[0.08] shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.05)] z-20">
        {/* Spacer: matches the absolute drag-region overlay so no interactive
            element sits under the traffic lights. */}
        <div data-tauri-drag-region className="h-10 w-full flex-shrink-0" />

        {/* Brand mark — mt-2 keeps it from feeling smashed under the spacer,
            mb-10 sets the rhythm down to the first nav button. */}
        <div className="mt-2 mb-10 w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <span className="font-bold text-white tracking-tighter text-lg">m</span>
        </div>

        {/* Primary nav — generous vertical breathing (24 px between buttons). */}
        <nav className="flex flex-col space-y-6 flex-1 w-full items-center">
          {/* Note: every button keeps a 1 px border slot (transparent when inactive)
              so the icon doesn't shift 1 px on activation. */}
          <button
            onClick={() => switchMode("single")}
            title="Single File"
            className={`p-3 rounded-xl border transition-all duration-200 ${
              mode === "single"
                ? "bg-ovl/10 border-ovl/10 shadow-sm text-fg drop-shadow-[0_0_8px_rgba(0,0,0,0.15)] dark:drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]"
                : "border-transparent text-fg-2 hover:text-fg hover:bg-ovl/5"
            }`}
          >
            <FileIcon size={22} strokeWidth={2} />
          </button>
          <button
            onClick={() => switchMode("batch")}
            title="Batch Edit"
            className={`p-3 rounded-xl border transition-all duration-200 ${
              mode === "batch"
                ? "bg-ovl/10 border-ovl/10 shadow-sm text-fg drop-shadow-[0_0_8px_rgba(0,0,0,0.15)] dark:drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]"
                : "border-transparent text-fg-2 hover:text-fg hover:bg-ovl/5"
            }`}
          >
            <Grid size={22} strokeWidth={2} />
          </button>
        </nav>

        {/* Bottom section — hairline separator + extra whitespace lifts
            Settings out of the primary-nav rhythm. */}
        <div className="w-full flex flex-col items-center pt-4 pb-5 border-t border-ovl/[0.08]">
          <button
            onClick={() => switchMode("settings")}
            title="Settings"
            className={`p-3 rounded-xl border transition-all duration-200 ${
              mode === "settings"
                ? "bg-ovl/10 border-ovl/10 shadow-sm text-fg drop-shadow-[0_0_8px_rgba(0,0,0,0.15)] dark:drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]"
                : "border-transparent text-fg-2 hover:text-fg hover:bg-ovl/5"
            }`}
          >
            <Settings size={22} strokeWidth={2} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 relative bg-app">
        {/* Spacer: matches drag region height — keeps content from hiding under traffic lights */}
        <div className="h-10 w-full flex-shrink-0" />
        {/* Scrollable Container */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar">
          <div className="mx-auto max-w-5xl">
            {mode === "single" ? (
              <SingleFileView
                keepBackups={settings.keepBackups}
                droppedFiles={pendingDropPaths}
                onDropHandled={() => setPendingDropPaths(null)}
                onDirtyChange={setDirty}
              />
            ) : mode === "batch" ? (
              <BatchView
                keepBackups={settings.keepBackups}
                defaultColumns={settings.defaultBatchColumns}
                droppedFiles={pendingDropPaths}
                onDropHandled={() => setPendingDropPaths(null)}
                onDirtyChange={setDirty}
              />
            ) : (
              <SettingsView settings={settings} onUpdate={updateSettings} />
            )}
          </div>
        </div>

        {/* Drag-over overlay (not shown in settings mode) */}
        {isDraggingOver && mode !== "settings" && (
          <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-none bg-app/80 backdrop-blur-sm">
            <div className="rounded-2xl border-2 border-dashed border-blue-500/60 bg-blue-500/5 px-16 py-12 text-center shadow-2xl">
              <div className="mb-2 text-4xl">⬇</div>
              <p className="text-lg font-semibold text-blue-600 dark:text-blue-300">Drop files to load</p>
              <p className="mt-1 text-sm text-fg-3">
                {mode === "single" ? "First file will be opened" : "All files will be added to selection"}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ────────────────────────── Single-file view ────────────────────────── */

function SingleFileView({
  keepBackups,
  droppedFiles,
  onDropHandled,
  onDirtyChange,
}: {
  keepBackups: boolean;
  droppedFiles?: string[] | null;
  onDropHandled?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newTags, setNewTags] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [editableOnly, setEditableOnly] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const tagPickerRef = useRef<HTMLDivElement>(null);

  const dirtyCount = Object.keys(edits).length;

  // Handle files dropped onto the window from the OS
  useEffect(() => {
    if (!droppedFiles?.length) return;
    const path = droppedFiles[0];
    (async () => {
      if (hasPending && !(await confirmDiscard("Opening another file will discard your unsaved changes."))) {
        onDropHandled?.();
        return;
      }
      setFilePath(path);
      await loadMetadata(path);
      onDropHandled?.();
    })();
  }, [droppedFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showTagPicker) return;
    function onMouseDown(e: MouseEvent) {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setShowTagPicker(false);
        setTagSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showTagPicker]);

  async function pickAndRead() {
    if (hasPending && !(await confirmDiscard("Opening another file will discard your unsaved changes."))) {
      return;
    }
    try {
      const selected = await open({
        multiple: false,
        filters: DIALOG_FILTERS,
      });
      if (typeof selected !== "string") return;
      setFilePath(selected);
      await loadMetadata(selected);
    } catch (e) {
      toast.error("Failed to open file chooser");
    }
  }

  async function loadMetadata(path: string) {
    setLoading(true);
    try {
      const data = await invoke<Metadata>("read_metadata", { filePath: path });
      setMetadata(data);
      setEdits({});
      setNewTags(new Set());
    } catch (e) {
      const err = e as ExifError;
      toast.error(err.kind || "Error reading metadata", {
        description: err.message
      });
      setMetadata(null);
    } finally {
      setLoading(false);
    }
  }

  function setEdit(key: string, value: string) {
    setEdits((prev) => {
      const original = formatValue(metadata?.[key]);
      if (value === original) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: value };
    });
  }

  function addTag(name: string) {
    setNewTags((prev) => new Set(prev).add(name));
    setShowTagPicker(false);
    setTagSearch("");
  }

  function discard() {
    setEdits({});
    setNewTags(new Set());
  }

  async function save() {
    if (!filePath) return;
    const writableEdits = Object.fromEntries(
      Object.entries(edits).filter(([k]) => isWritable(k)),
    );
    // Captured before loadMetadata() resets state — can't read dirtyCount after the await.
    const savedCount = Object.keys(writableEdits).length;
    if (savedCount === 0) return;

    setSaving(true);
    try {
      await saveFilesMetadata([filePath], writableEdits, keepBackups);
      await loadMetadata(filePath);
      toast.success("Metadata saved", {
        description: `Updated ${savedCount} field${savedCount === 1 ? "" : "s"} in ${basename(filePath)}`,
        duration: 4000,
      });
    } catch (e) {
      const err = e as ExifError;
      toast.error("Failed to save changes", {
        description: err.message
      });
    } finally {
      setSaving(false);
    }
  }

  const existingTagNames = useMemo(() => {
    if (!metadata) return new Set<string>();
    return new Set(
      Object.keys(metadata).map((k) => {
        const i = k.indexOf(":");
        return (i >= 0 ? k.slice(i + 1) : k).toLowerCase();
      }),
    );
  }, [metadata]);

  // Broad metadata category for the currently-open file ("image" / "video" /
  // "audio" / "document"). Drives format-aware filtering of the tag picker.
  // null = unknown extension; only universal tags are shown in that case.
  const fileCategory = useMemo(
    () => (filePath ? categorizeFile(filePath) : null),
    [filePath],
  );

  // True when the loaded file is a plain-text format (.txt/.md/.rtf) with no
  // internal metadata container. Drives the read-only banner + disables
  // Save and Add Tag — attempting either returns `ToolError: exit Some(1)`
  // from ExifTool, which we'd rather not even let the user trigger.
  const isReadOnlyFormat = useMemo(
    () => (filePath ? !hasWritableMetadata(filePath) : false),
    [filePath],
  );

  const pickerTags = useMemo(() => {
    const q = tagSearch.toLowerCase();
    return COMMON_TAGS.filter((t) => {
      if (newTags.has(t.name)) return false;
      if (existingTagNames.has(t.name.toLowerCase())) return false;
      // Format gate: tags without a `formats` array are universal. Tags with
      // one only show for matching categories. Unknown extension (null
      // category) only sees universal tags.
      if (t.formats && (!fileCategory || !t.formats.includes(fileCategory))) {
        return false;
      }
      if (q === "") return true;
      return (
        t.name.toLowerCase().includes(q) || t.hint.toLowerCase().includes(q)
      );
    });
  }, [existingTagNames, newTags, tagSearch, fileCategory]);

  const entries = useMemo(() => {
    if (!metadata) return [];
    const q = filter.toLowerCase();

    const existing = Object.entries(metadata).filter(([k, v]) => {
      if (editableOnly && !isWritable(k)) return false;
      return q
        ? k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
        : true;
    });

    const added = [...newTags]
      .filter((tag) => !(tag in metadata))
      .filter((tag) => !q || tag.toLowerCase().includes(q))
      .map((tag) => [tag, undefined] as [string, unknown]);

    return [...existing, ...added];
  }, [metadata, filter, editableOnly, newTags]);

  const hasPending = dirtyCount > 0 || newTags.size > 0;
  // True when the user filtered/added nothing matched — used to show a
  // "no results" hint instead of a blank gap below the toolbar.
  const noMatches = metadata !== null && entries.length === 0;

  // Report pending edits to the parent (sidebar + quit guards); clear on unmount.
  useEffect(() => {
    onDirtyChange?.(hasPending);
    return () => onDirtyChange?.(false);
  }, [hasPending]); // eslint-disable-line react-hooks/exhaustive-deps

  useCmdKey({
    o: (e) => {
      e.preventDefault();
      if (!loading && !saving) pickAndRead();
    },
    s: (e) => {
      e.preventDefault();
      if (!saving && dirtyCount > 0 && !isReadOnlyFormat) save();
    },
  });

  return (
    <section>
      {filePath && (
        <div className="mb-8 p-6 rounded-2xl bg-panel border border-line flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-5 overflow-hidden">
            <div className="h-14 w-14 flex-shrink-0 bg-elevated/80 rounded-xl flex items-center justify-center border border-line-strong/50 shadow-inner">
              <FileImage size={28} className="text-fg-3" />
            </div>
            <div className="min-w-0 pr-4">
              <h2 className="text-lg font-semibold text-fg truncate tracking-tight">{basename(filePath)}</h2>
              <p className="text-xs text-fg-4 truncate mt-1 font-mono">{filePath}</p>
            </div>
          </div>
          
          <div className="flex-shrink-0 ml-4 flex gap-3">
              {hasPending && (
                <button
                  onClick={discard}
                  disabled={saving}
                  title="Discard unsaved changes"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-fg-3 hover:bg-elevated hover:text-fg transition-colors disabled:opacity-50"
                >
                  <RotateCcw size={16} />
                  Discard
                </button>
              )}
              <button
                onClick={pickAndRead}
                disabled={loading || saving}
                title={`Open file (${MOD_LABEL}O)`}
                className="flex items-center gap-2 rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-fg-2 hover:bg-elevated2 hover:text-fg transition-colors disabled:opacity-50"
              >
                <Folder size={16} />
                {loading ? "Reading…" : "Open File"}
              </button>
              <button
                onClick={save}
                disabled={saving || dirtyCount === 0 || isReadOnlyFormat}
                title={isReadOnlyFormat ? "This format has no internal metadata container" : `Save changes (${MOD_LABEL}S)`}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:shadow-none"
              >
                <Save size={16} />
                {saving ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount} Changes` : "Save Changes"}
              </button>
          </div>
        </div>
      )}

      {!filePath && (
        <div className="flex flex-col items-center justify-center py-32 mt-12 text-center rounded-3xl border border-dashed border-line bg-panel/30">
          <div className="w-20 h-20 rounded-2xl bg-elevated/80 flex items-center justify-center mb-6 text-fg-3 shadow-inner border border-line-strong/50">
            <FileImage size={36} strokeWidth={1.5} />
          </div>
          <h3 className="text-xl font-medium text-fg mb-2 tracking-tight">No file selected</h3>
          <p className="text-fg-4 max-w-sm mb-8 text-sm">Select a media file or document to inspect and edit its metadata.</p>
          <button
            onClick={pickAndRead}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-inverted px-8 py-3 text-sm font-medium text-on-inverted hover:bg-inverted/85 transition-all shadow-lg hover:shadow-xl active:scale-95"
          >
            <Folder size={18} />
            {loading ? "Reading…" : "Open File"}
          </button>
        </div>
      )}

      {metadata && isReadOnlyFormat && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <Lock size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-200">Internal metadata not supported for this format (Read-only)</p>
            <p className="text-amber-700/80 dark:text-amber-300/70 text-xs mt-1">
              Plain-text files (.txt, .md, .rtf) have no metadata container. Filesystem
              attributes are shown above for reference; Save and Add Tag are disabled.
            </p>
          </div>
        </div>
      )}

      {metadata && (
        <>
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1 max-w-md">
              <div className="relative w-full">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-4" />
                <input
                  type="search"
                  placeholder="Filter tags…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-full rounded-xl border border-line bg-panel/50 pl-10 pr-4 py-2.5 text-sm text-fg placeholder-fg-4 focus:border-blue-500/50 focus:bg-panel focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
              <label className="flex shrink-0 select-none items-center gap-2.5 text-sm text-fg-3 cursor-pointer hover:text-fg transition-colors">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={editableOnly}
                    onChange={(e) => setEditableOnly(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-5 rounded border border-line-strong bg-panel peer-focus:ring-2 peer-focus:ring-blue-500/30 peer-checked:bg-blue-600 peer-checked:border-blue-600 transition-colors"></div>
                  <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                Editable only
              </label>
            </div>
            
            {/* Tag picker */}
            <div ref={tagPickerRef} className="relative ml-4">
              <button
                onClick={() => setShowTagPicker((v) => !v)}
                disabled={isReadOnlyFormat}
                title={isReadOnlyFormat ? "This format has no internal metadata container" : undefined}
                className="flex items-center gap-2 rounded-xl border border-line-strong bg-elevated px-5 py-2.5 text-sm font-medium text-fg hover:bg-elevated2 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-elevated disabled:hover:text-fg"
              >
                <Plus size={16} /> Add Tag
              </button>
              {showTagPicker && (
                <div className="absolute right-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/60">
                  <div className="border-b border-line p-2 bg-panel">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-4" />
                      <input
                        autoFocus
                        type="search"
                        value={tagSearch}
                        onChange={(e) => setTagSearch(e.target.value)}
                        placeholder="Search tags…"
                        className="w-full rounded-lg border border-line bg-app pl-9 pr-3 py-2 text-sm text-fg placeholder-fg-4 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                      />
                    </div>
                  </div>
                  <ul className="max-h-64 overflow-y-auto py-1 custom-scrollbar">
                    {pickerTags.length === 0 ? (
                      <li className="px-4 py-6 text-sm text-fg-4 text-center">
                        All common tags already present
                      </li>
                    ) : (
                      pickerTags.map((t) => (
                        <li key={t.name}>
                          <button
                            onClick={() => addTag(t.name)}
                            className="w-full px-4 py-2.5 text-left hover:bg-elevated transition-colors flex flex-col gap-1"
                          >
                            <span className="font-mono text-sm font-medium text-fg">
                              {t.name}
                            </span>
                            <span className="text-xs text-fg-4">
                              {t.hint}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-[2px]">
            {entries.map(([key, value]) => {
              const writable = isWritable(key);
              const isDirty = key in edits;
              const isNew = newTags.has(key);
              const display = isDirty ? edits[key] : formatValue(value);
              
              return (
                <div
                  key={key}
                  className={`group relative flex items-center gap-4 rounded-xl px-4 py-3 transition-colors ${
                    isDirty
                      ? "bg-blue-500/5 hover:bg-blue-500/10"
                      : isNew
                        ? "bg-emerald-500/5 hover:bg-emerald-500/10 border-l-2 border-l-emerald-500 pl-3.5"
                        : "bg-panel/30 hover:bg-panel"
                  }`}
                >
                  <div className="w-[30%] shrink-0 flex items-center gap-2">
                    {!writable && <Lock size={14} className="text-fg-5 shrink-0" />}
                    <span className="font-mono text-sm text-fg-3 truncate tracking-tight" title={key}>
                      {key}
                    </span>
                    {isNew && (
                      <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        New
                      </span>
                    )}
                    {isDirty && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ml-2 shadow-[0_0_8px_rgba(59,130,246,0.8)]"></span>
                    )}
                  </div>
                  <div className="flex-1 flex items-center gap-3 min-w-0">
                    <input
                      type="text"
                      disabled={!writable}
                      value={display}
                      onChange={(e) => setEdit(key, e.target.value)}
                      placeholder={isNew ? "Enter value…" : undefined}
                      className={`w-full rounded-lg bg-panel/80 border ${
                        isDirty 
                          ? "border-blue-500/30 text-blue-700 dark:text-blue-100 focus:border-blue-500"
                          : isNew
                            ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-100 focus:border-emerald-500 placeholder-emerald-600/40 dark:placeholder-emerald-700/50"
                            : "border-line text-fg focus:border-blue-500/50"
                      } px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 disabled:bg-transparent disabled:border-transparent transition-all shadow-sm`}
                    />
                    {isNew && (
                      <button
                        onClick={() => {
                           setNewTags(prev => {
                             const next = new Set(prev);
                             next.delete(key);
                             return next;
                           });
                           setEdits(prev => {
                             const { [key]: _, ...rest } = prev;
                             return rest;
                           });
                        }}
                        className="p-2 text-fg-4 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Remove tag"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {noMatches && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search size={28} className="text-fg-6 mb-3" strokeWidth={1.5} />
              <p className="text-sm text-fg-3">
                {editableOnly && !filter
                  ? "No editable tags in this file"
                  : "No tags match your filter"}
              </p>
              {(filter || editableOnly) && (
                <button
                  onClick={() => { setFilter(""); setEditableOnly(false); }}
                  className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ─────────────────────────────── Batch view ─────────────────────────────── */

function BatchView({
  keepBackups,
  defaultColumns,
  droppedFiles,
  onDropHandled,
  onDirtyChange,
}: {
  keepBackups: boolean;
  defaultColumns: string[];
  droppedFiles?: string[] | null;
  onDropHandled?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // defaultColumns is only read at mount — session columns are independent after that
  const [columns, setColumns] = useState<string[]>(() => defaultColumns);
  const [showColPicker, setShowColPicker] = useState(false);
  const [colPickerSearch, setColPickerSearch] = useState("");
  const colPickerRef = useRef<HTMLDivElement>(null);

  // Shared category across the loaded batch — null when empty or mixed
  // (mixed batches see every tag; format-gating only kicks in when every
  // file shares a single category, e.g. a folder of MKVs or JPEGs).
  const batchCategory = useMemo(() => {
    if (items.length === 0) return null;
    const cats = new Set(items.map((i) => categorizeFile(i.file_path)));
    if (cats.size !== 1) return null;
    return cats.values().next().value ?? null;
  }, [items]);

  const filteredColTags = useMemo(
    () =>
      COMMON_TAGS.filter((t) => {
        if (columns.includes(t.name)) return false;
        // Same format gate as the single-file picker, applied only when the
        // whole batch shares one category. Universal tags always pass.
        if (
          t.formats &&
          batchCategory &&
          !t.formats.includes(batchCategory)
        ) {
          return false;
        }
        if (!colPickerSearch) return true;
        const q = colPickerSearch.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.hint.toLowerCase().includes(q);
      }),
    [columns, colPickerSearch, batchCategory],
  );

  const dirtyFileCount = Object.keys(edits).length;
  const dirtyEditCount = Object.values(edits).reduce(
    (n, e) => n + Object.keys(e).length,
    0,
  );

  // Report pending edits to the parent (sidebar + quit guards); clear on unmount.
  useEffect(() => {
    onDirtyChange?.(dirtyFileCount > 0);
    return () => onDirtyChange?.(false);
  }, [dirtyFileCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close column picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false);
        setColPickerSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Handle files dropped onto the window — merges into existing selection (no edits cleared)
  useEffect(() => {
    if (!droppedFiles?.length) return;
    addFilesToSelection(droppedFiles);
    onDropHandled?.();
  }, [droppedFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addFilesToSelection(paths: string[]) {
    const existingPaths = new Set(items.map((i) => i.file_path));
    const novel = paths
      .filter((p) => !existingPaths.has(p))
      .sort(naturalSortPaths);
    if (novel.length === 0) return;
    setLoading(true);
    try {
      const newItems = await invoke<BatchItem[]>("read_metadata_batch", {
        filePaths: novel,
      });
      // Merge and re-sort so newly added files land in the right position
      setItems((prev) =>
        [...prev, ...newItems].sort((a, b) => naturalSortPaths(a.file_path, b.file_path)),
      );
    } catch (e) {
      const err = e as ExifError;
      toast.error(err.kind || "Failed to load dropped files", { description: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function pickFiles() {
    if (dirtyFileCount > 0 && !(await confirmDiscard("Selecting new files will discard your unsaved changes."))) {
      return;
    }
    try {
      const selected = await open({
        multiple: true,
        filters: DIALOG_FILTERS,
      });
      if (!Array.isArray(selected) || selected.length === 0) return;

      setLoading(true);
      const sorted = [...selected].sort(naturalSortPaths);
      const results = await invoke<BatchItem[]>("read_metadata_batch", {
        filePaths: sorted,
      });
      setItems(results);
      setEdits({});
    } catch (e) {
      const err = e as ExifError;
      toast.error(err.kind || "Failed to load files", {
        description: err.message
      });
    } finally {
      setLoading(false);
    }
  }

  function setCellEdit(filePath: string, tag: string, value: string) {
    setEdits((prev) => {
      const item = items.find((i) => i.file_path === filePath);
      const original = item?.metadata ? formatValue(item.metadata[tag]) : "";
      const fileEdits = { ...(prev[filePath] ?? {}) };

      if (value === original) delete fileEdits[tag];
      else fileEdits[tag] = value;

      const next = { ...prev };
      if (Object.keys(fileEdits).length === 0) delete next[filePath];
      else next[filePath] = fileEdits;
      return next;
    });
  }

  function applyColumnToAll(tag: string, value: string) {
    setEdits((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (item.error) continue;
        const original = formatValue(item.metadata?.[tag]);
        const fileEdits = { ...(next[item.file_path] ?? {}) };
        if (value === original) delete fileEdits[tag];
        else fileEdits[tag] = value;
        if (Object.keys(fileEdits).length === 0) delete next[item.file_path];
        else next[item.file_path] = fileEdits;
      }
      return next;
    });
    toast.success(`Applied value to all editable files for ${tag}`);
  }

  function removeColumn(tag: string) {
    setColumns((prev) => prev.filter((c) => c !== tag));
    setEdits((prev) => {
      const next = { ...prev };
      for (const fp of Object.keys(next)) {
        if (tag in next[fp]) {
          const { [tag]: _, ...rest } = next[fp];
          if (Object.keys(rest).length === 0) delete next[fp];
          else next[fp] = rest;
        }
      }
      return next;
    });
  }

  async function saveAll() {
    if (dirtyFileCount === 0) return;
    setSaving(true);
    try {
      const fileUpdates: FileUpdate[] = Object.entries(edits)
        .map(([filePath, tags]) => {
          const resolved = Object.fromEntries(
            Object.entries(tags)
              .filter(([k]) => isWritable(k))
              .map(([k, v]) => [k, resolveVariables(v, filePath)]),
          );
          return { path: filePath, updates: resolved };
        })
        .filter((fu) => Object.keys(fu.updates).length > 0);

      if (fileUpdates.length === 0) return;

      // Capture before the save — reading from `edits` after success would be stale
      // (we call setEdits({}) below) and reading from results doesn't carry edit counts.
      const totalEdits = fileUpdates.reduce((n, fu) => n + Object.keys(fu.updates).length, 0);

      const results: BulkSaveResult[] = await invoke("bulk_save_metadata", { fileUpdates, keepBackups });
      const failed = results.filter((r) => !r.ok);

      try {
        const fresh = await invoke<BatchItem[]>("read_metadata_batch", {
          filePaths: items.map((i) => i.file_path),
        });
        setItems(fresh);
        setEdits({});
      } catch {
        // reload failure is non-fatal
      }

      if (failed.length === 0) {
        toast.success(`Saved ${results.length} file${results.length === 1 ? "" : "s"}`, {
          description: `${totalEdits} edit${totalEdits === 1 ? "" : "s"} written.`,
          duration: 4000,
        });
      } else {
        toast.error(`Saved ${results.length - failed.length}/${results.length} files.`, {
          description: failed
            .map((f) => `${basename(f.path)}: ${f.error?.message ?? "unknown"}`)
            .join("; "),
        });
      }
    } catch (e) {
      const err = e as ExifError;
      toast.error(err.kind || "Save failed", { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  function discardAll() {
    setEdits({});
  }

  useCmdKey({
    o: (e) => {
      e.preventDefault();
      if (!loading && !saving) pickFiles();
    },
    s: (e) => {
      e.preventDefault();
      if (!saving && dirtyFileCount > 0) saveAll();
    },
  });

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <div className="text-sm text-fg-3">
          {items.length > 0 ? (
            <span className="flex items-center gap-2">
               <span className="font-medium text-fg">{items.length} file{items.length === 1 ? "" : "s"}</span>
               {dirtyEditCount > 0 && (
                 <>
                   <span className="w-1 h-1 rounded-full bg-elevated2"></span>
                   <span className="text-blue-600 dark:text-blue-400 font-medium">{dirtyEditCount} unsaved edit{dirtyEditCount === 1 ? "" : "s"}</span>
                 </>
               )}
            </span>
          ) : (
            "Select files to begin"
          )}
        </div>
        <div className="flex gap-3">
          {dirtyFileCount > 0 && (
            <button
              onClick={discardAll}
              disabled={saving}
              title="Discard all unsaved edits"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-fg-3 hover:bg-elevated hover:text-fg transition-colors disabled:opacity-50"
            >
              <RotateCcw size={16} />
              Discard
            </button>
          )}
          <button
            onClick={pickFiles}
            disabled={loading || saving}
            title={`Select files (${MOD_LABEL}O)`}
            className="flex items-center gap-2 rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-fg-2 hover:bg-elevated2 hover:text-fg transition-colors disabled:opacity-50"
          >
            <Folder size={16} />
            {loading ? "Reading…" : "Select Files"}
          </button>
          <button
            onClick={saveAll}
            disabled={saving || dirtyFileCount === 0}
            title={`Save all changes (${MOD_LABEL}S)`}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:shadow-none"
          >
            <Save size={16} />
            {saving
              ? "Saving…"
              : dirtyFileCount > 0
                ? `Save ${dirtyFileCount} File${dirtyFileCount === 1 ? "" : "s"}`
                : "Save All"}
          </button>
        </div>
      </div>

      {items.length > 0 && (
        <>
          {/* ── Column picker (above table, outside overflow container) ── */}
          <div className="mb-2 flex items-center justify-end">
            <div ref={colPickerRef} className="relative">
              <button
                onClick={() => { setShowColPicker((v) => !v); setColPickerSearch(""); }}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-xs text-fg-4 hover:border-line-strong hover:text-fg-2 transition-colors"
              >
                <Plus size={12} />
                Add Column
              </button>
              {showColPicker && (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-line-strong bg-panel shadow-2xl shadow-black/50">
                  <div className="p-2 border-b border-line">
                    <input
                      type="text"
                      autoFocus
                      value={colPickerSearch}
                      onChange={(e) => setColPickerSearch(e.target.value)}
                      placeholder="Search tags…"
                      className="w-full rounded-lg bg-elevated px-3 py-1.5 text-xs text-fg placeholder-fg-4 outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto py-1">
                    {filteredColTags.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-fg-4">All tags added</p>
                    ) : (
                      filteredColTags.map((t) => (
                        <button
                          key={t.name}
                          onClick={() => {
                            setColumns((prev) => [...prev, t.name]);
                            setShowColPicker(false);
                            setColPickerSearch("");
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-elevated transition-colors"
                        >
                          <span className="block font-mono text-xs text-fg">{t.name}</span>
                          <span className="block text-[10px] text-fg-4">{t.hint}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Table ── */}
          <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-xl shadow-black/20">
            <div className="max-h-[70vh] overflow-auto custom-scrollbar">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="sticky top-0 z-10 bg-panel/95 backdrop-blur text-xs uppercase tracking-wider text-fg-4 border-b border-line">
                  <tr>
                    <th className="sticky left-0 z-20 min-w-[300px] bg-panel/95 backdrop-blur px-5 py-4 font-semibold border-b border-line">
                      File
                    </th>
                    {columns.map((col) => (
                      <BatchHeaderCell
                        key={col}
                        tag={col}
                        onApplyAll={(value) => applyColumnToAll(col, value)}
                        onRemove={() => removeColumn(col)}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {items.map((item) => (
                    <tr
                      key={item.file_path}
                      className="hover:bg-elevated/50 transition-colors group"
                    >
                      <td
                        className="sticky left-0 z-10 min-w-[300px] bg-panel group-hover:bg-elevated/80 px-5 py-3 font-mono text-xs text-fg-2 transition-colors"
                        title={item.file_path}
                      >
                        <div className="flex items-center gap-3">
                          <FileImage size={16} className="text-fg-4 shrink-0" />
                          <span className="truncate">{basename(item.file_path)}</span>
                        </div>
                        {item.error && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-red-400">
                            <AlertCircle size={12} />
                            <span className="truncate max-w-[200px]">{item.error.kind}</span>
                          </div>
                        )}
                      </td>
                      {columns.map((col) => {
                        const dirty = edits[item.file_path]?.[col] !== undefined;
                        const rawValue = dirty
                          ? edits[item.file_path][col]
                          : formatValue(findMetadataValue(item.metadata, col));
                        const preview =
                          dirty && containsTemplate(rawValue)
                            ? resolveVariables(rawValue, item.file_path)
                            : null;
                        return (
                          <td
                            key={col}
                            className={`px-3 py-2 align-top ${dirty ? "bg-blue-500/5" : ""}`}
                          >
                            <input
                              type="text"
                              disabled={!!item.error}
                              value={rawValue}
                              onChange={(e) =>
                                setCellEdit(item.file_path, col, e.target.value)
                              }
                              className={`w-full min-w-[150px] rounded-lg bg-app/50 border px-3 py-2 font-mono text-xs outline-none focus:bg-app focus:ring-2 focus:ring-blue-500/30 disabled:opacity-40 transition-all ${
                                dirty
                                  ? "border-blue-500/30 text-blue-700 dark:text-blue-200"
                                  : "border-line/50 text-fg-2 hover:border-line-strong"
                              }`}
                            />
                            {preview && (
                              <div className="mt-0.5 truncate px-1 font-mono text-[10px] text-blue-400/60">
                                → {preview}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32 mt-12 text-center rounded-3xl border border-dashed border-line bg-panel/30">
          <div className="w-20 h-20 rounded-2xl bg-elevated/80 flex items-center justify-center mb-6 text-fg-3 shadow-inner border border-line-strong/50">
            <Grid size={36} strokeWidth={1.5} />
          </div>
          <h3 className="text-xl font-medium text-fg mb-2 tracking-tight">No files selected</h3>
          <p className="text-fg-4 max-w-sm mb-8 text-sm">
            Select multiple files or drop them here to edit their metadata side by side.
          </p>
          <button
            onClick={pickFiles}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-inverted px-8 py-3 text-sm font-medium text-on-inverted hover:bg-inverted/85 transition-all shadow-lg hover:shadow-xl active:scale-95 disabled:opacity-60"
          >
            <Folder size={18} />
            {loading ? "Reading…" : "Select Files"}
          </button>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────── shared bits ───────────────────────────── */

function BatchHeaderCell({
  tag,
  onApplyAll,
  onRemove,
}: {
  tag: string;
  onApplyAll: (value: string) => void;
  onRemove: () => void;
}) {
  const [bulkValue, setBulkValue] = useState("");
  return (
    <th className="group px-3 py-3 align-bottom font-medium border-b border-line">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] normal-case text-fg-3 tracking-normal">{tag}</span>
        <button
          onClick={onRemove}
          className="p-0.5 text-fg-5 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
          title="Remove column"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={bulkValue}
          onChange={(e) => setBulkValue(e.target.value)}
          placeholder="Apply to all…"
          className="w-full min-w-[120px] rounded-lg border border-line-strong bg-app px-3 py-1.5 font-mono text-xs font-normal text-fg focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
        />
        <button
          onClick={() => {
            if (bulkValue) {
               onApplyAll(bulkValue);
               setBulkValue("");
            }
          }}
          className="rounded-lg bg-elevated px-3 py-1.5 text-xs font-medium text-fg-2 hover:bg-elevated2 hover:text-fg transition-colors"
        >
          Apply
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-fg-5 leading-snug">
        <span className="font-mono text-fg-4">{"{filename}"}</span>{" "}name ·{" "}
        <span className="font-mono text-fg-4">{"{ext}"}</span>{" "}ext ·{" "}
        <span className="font-mono text-fg-4">{"{filename|match:S(\\d+)}"}</span>{" "}regex
      </p>
    </th>
  );
}

// Natural sort by filename only: "E02" < "E11", case-insensitive.
// Comparing basenames instead of full paths avoids the numeric collator
// picking up unrelated numbers earlier in the path (drive letters, dates, etc.).
function naturalSortPaths(a: string, b: string): number {
  return basename(a).localeCompare(basename(b), undefined, { numeric: true, sensitivity: "base" });
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ExifTool returns fully-qualified keys ("EXIF:Artist", "XMP:Title"). Column names
// from COMMON_TAGS are short ("Artist", "Title"). Try exact match first, then suffix.
function findMetadataValue(metadata: Metadata | null, tag: string): unknown {
  if (!metadata) return undefined;
  if (tag in metadata) return metadata[tag];
  const suffix = `:${tag}`;
  const key = Object.keys(metadata).find((k) => k.endsWith(suffix));
  return key ? metadata[key] : undefined;
}
