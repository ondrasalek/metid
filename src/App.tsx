import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Toaster, toast } from "sonner";
import {
  FileIcon, FileImage, Settings, Grid, Trash2,
  Lock, Plus, Search, Folder, Save, AlertCircle, X
} from "lucide-react";
import "./App.css";
import { COMMON_TAGS } from "./constants";
import { useSettings } from "./hooks/useSettings";
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

const MEDIA_EXT = [
  "jpg", "jpeg", "png", "tiff", "tif", "heic", "heif", "webp",
  "cr2", "cr3", "nef", "arw", "dng", "raf", "orf",
  "mp4", "mov", "avi", "mkv", "m4v",
  "mp3", "flac", "wav", "m4a", "ogg", "pdf",
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
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans selection:bg-blue-500/30">
      <Toaster theme="dark" position="bottom-right" className="font-sans" />
      
      {/* Sidebar */}
      <aside className="w-16 flex-shrink-0 flex flex-col items-center py-4 bg-zinc-950 border-r border-zinc-900/80 z-20">
        <div className="mb-8 w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <span className="font-bold text-white tracking-tighter text-lg">m</span>
        </div>

        <nav className="flex flex-col gap-3 flex-1 w-full items-center">
          <button
            onClick={() => setMode("single")}
            title="Single File"
            className={`p-3 rounded-xl transition-all duration-200 ${
              mode === "single"
                ? "bg-blue-500/10 text-blue-500"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
            }`}
          >
            <FileIcon size={22} strokeWidth={mode === "single" ? 2.5 : 2} />
          </button>
          <button
            onClick={() => setMode("batch")}
            title="Batch Edit"
            className={`p-3 rounded-xl transition-all duration-200 ${
              mode === "batch"
                ? "bg-blue-500/10 text-blue-500"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
            }`}
          >
            <Grid size={22} strokeWidth={mode === "batch" ? 2.5 : 2} />
          </button>
        </nav>

        <div className="mt-auto">
          <button
            onClick={() => setMode("settings")}
            title="Settings"
            className={`p-3 rounded-xl transition-all duration-200 ${
              mode === "settings"
                ? "bg-blue-500/10 text-blue-500"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
            }`}
          >
            <Settings size={22} strokeWidth={mode === "settings" ? 2.5 : 2} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Titlebar draggable area */}
        <div data-tauri-drag-region className="h-10 w-full flex-shrink-0 flex items-center px-4 border-b border-zinc-900/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
          <span data-tauri-drag-region className="text-[10px] font-bold text-zinc-600 tracking-widest uppercase select-none">
            metid
          </span>
        </div>

        {/* Scrollable Container */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar">
          <div className="mx-auto max-w-5xl">
            {mode === "single" ? (
              <SingleFileView
                keepBackups={settings.keepBackups}
                droppedFiles={pendingDropPaths}
                onDropHandled={() => setPendingDropPaths(null)}
              />
            ) : mode === "batch" ? (
              <BatchView
                keepBackups={settings.keepBackups}
                defaultColumns={settings.defaultBatchColumns}
                droppedFiles={pendingDropPaths}
                onDropHandled={() => setPendingDropPaths(null)}
              />
            ) : (
              <SettingsView settings={settings} onUpdate={updateSettings} />
            )}
          </div>
        </div>

        {/* Drag-over overlay (not shown in settings mode) */}
        {isDraggingOver && mode !== "settings" && (
          <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-none bg-zinc-950/80 backdrop-blur-sm">
            <div className="rounded-2xl border-2 border-dashed border-blue-500/60 bg-blue-500/5 px-16 py-12 text-center shadow-2xl">
              <div className="mb-2 text-4xl">⬇</div>
              <p className="text-lg font-semibold text-blue-300">Drop files to load</p>
              <p className="mt-1 text-sm text-zinc-400">
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
}: {
  keepBackups: boolean;
  droppedFiles?: string[] | null;
  onDropHandled?: () => void;
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
    setFilePath(path);
    loadMetadata(path);
    onDropHandled?.();
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
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Media & Documents", extensions: MEDIA_EXT },
          { name: "All Files", extensions: ["*"] },
        ],
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

  async function save() {
    if (!filePath) return;
    const writableEdits = Object.fromEntries(
      Object.entries(edits).filter(([k]) => isWritable(k)),
    );
    if (Object.keys(writableEdits).length === 0) return;
    
    setSaving(true);
    try {
      await saveFilesMetadata([filePath], writableEdits, keepBackups);
      await loadMetadata(filePath);
      toast.success("Metadata saved successfully!");
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

  const pickerTags = useMemo(() => {
    const q = tagSearch.toLowerCase();
    return COMMON_TAGS.filter(
      (t) =>
        !newTags.has(t.name) &&
        !existingTagNames.has(t.name.toLowerCase()) &&
        (q === "" || t.name.toLowerCase().includes(q) || t.hint.toLowerCase().includes(q)),
    );
  }, [existingTagNames, newTags, tagSearch]);

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

  return (
    <section>
      {filePath && (
        <div className="mb-8 p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-5 overflow-hidden">
            <div className="h-14 w-14 flex-shrink-0 bg-zinc-800/80 rounded-xl flex items-center justify-center border border-zinc-700/50 shadow-inner">
              <FileImage size={28} className="text-zinc-400" />
            </div>
            <div className="min-w-0 pr-4">
              <h2 className="text-lg font-semibold text-zinc-100 truncate tracking-tight">{basename(filePath)}</h2>
              <p className="text-xs text-zinc-500 truncate mt-1 font-mono">{filePath}</p>
            </div>
          </div>
          
          <div className="flex-shrink-0 ml-4 flex gap-3">
              <button
                onClick={pickAndRead}
                disabled={loading || saving}
                className="flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors disabled:opacity-50"
              >
                <Folder size={16} />
                {loading ? "Reading…" : "Open File"}
              </button>
              <button
                onClick={save}
                disabled={saving || dirtyCount === 0}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:shadow-none"
              >
                <Save size={16} />
                {saving ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount} Changes` : "Save Changes"}
              </button>
          </div>
        </div>
      )}

      {!filePath && (
        <div className="flex flex-col items-center justify-center py-32 mt-12 text-center rounded-3xl border border-dashed border-zinc-800 bg-zinc-900/30">
          <div className="w-20 h-20 rounded-2xl bg-zinc-800/80 flex items-center justify-center mb-6 text-zinc-400 shadow-inner border border-zinc-700/50">
            <FileImage size={36} strokeWidth={1.5} />
          </div>
          <h3 className="text-xl font-medium text-zinc-200 mb-2 tracking-tight">No file selected</h3>
          <p className="text-zinc-500 max-w-sm mb-8 text-sm">Select a media file or document to inspect and edit its metadata.</p>
          <button
            onClick={pickAndRead}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-white px-8 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-all shadow-lg hover:shadow-xl active:scale-95"
          >
            <Folder size={18} />
            {loading ? "Reading…" : "Open File"}
          </button>
        </div>
      )}

      {metadata && (
        <>
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1 max-w-md">
              <div className="relative w-full">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="search"
                  placeholder="Filter tags…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 pl-10 pr-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:border-blue-500/50 focus:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
              <label className="flex shrink-0 select-none items-center gap-2.5 text-sm text-zinc-400 cursor-pointer hover:text-zinc-200 transition-colors">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={editableOnly}
                    onChange={(e) => setEditableOnly(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-5 rounded border border-zinc-700 bg-zinc-900 peer-focus:ring-2 peer-focus:ring-blue-500/30 peer-checked:bg-blue-600 peer-checked:border-blue-600 transition-colors"></div>
                  <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                Editable only
              </label>
            </div>
            
            {/* Tag picker */}
            <div ref={tagPickerRef} className="relative ml-4">
              <button
                onClick={() => setShowTagPicker((v) => !v)}
                className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors shadow-sm"
              >
                <Plus size={16} /> Add Tag
              </button>
              {showTagPicker && (
                <div className="absolute right-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60">
                  <div className="border-b border-zinc-800 p-2 bg-zinc-900">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input
                        autoFocus
                        type="search"
                        value={tagSearch}
                        onChange={(e) => setTagSearch(e.target.value)}
                        placeholder="Search tags…"
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                      />
                    </div>
                  </div>
                  <ul className="max-h-64 overflow-y-auto py-1 custom-scrollbar">
                    {pickerTags.length === 0 ? (
                      <li className="px-4 py-6 text-sm text-zinc-500 text-center">
                        All common tags already present
                      </li>
                    ) : (
                      pickerTags.map((t) => (
                        <li key={t.name}>
                          <button
                            onClick={() => addTag(t.name)}
                            className="w-full px-4 py-2.5 text-left hover:bg-zinc-800 transition-colors flex flex-col gap-1"
                          >
                            <span className="font-mono text-sm font-medium text-zinc-200">
                              {t.name}
                            </span>
                            <span className="text-xs text-zinc-500">
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
                        : "bg-zinc-900/30 hover:bg-zinc-900"
                  }`}
                >
                  <div className="w-[30%] shrink-0 flex items-center gap-2">
                    {!writable && <Lock size={14} className="text-zinc-600 shrink-0" />}
                    <span className="font-mono text-sm text-zinc-400 truncate tracking-tight" title={key}>
                      {key}
                    </span>
                    {isNew && (
                      <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-400 border border-emerald-500/20">
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
                      className={`w-full rounded-lg bg-zinc-900/80 border ${
                        isDirty 
                          ? "border-blue-500/30 text-blue-100 focus:border-blue-500" 
                          : isNew 
                            ? "border-emerald-500/30 text-emerald-100 focus:border-emerald-500 placeholder-emerald-700/50" 
                            : "border-zinc-800 text-zinc-200 focus:border-blue-500/50"
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
                        className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
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
}: {
  keepBackups: boolean;
  defaultColumns: string[];
  droppedFiles?: string[] | null;
  onDropHandled?: () => void;
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

  const filteredColTags = useMemo(
    () =>
      COMMON_TAGS.filter(
        (t) =>
          !columns.includes(t.name) &&
          (!colPickerSearch ||
            t.name.toLowerCase().includes(colPickerSearch.toLowerCase()) ||
            t.hint.toLowerCase().includes(colPickerSearch.toLowerCase())),
      ),
    [columns, colPickerSearch],
  );

  const dirtyFileCount = Object.keys(edits).length;
  const dirtyEditCount = Object.values(edits).reduce(
    (n, e) => n + Object.keys(e).length,
    0,
  );

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
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: "Media & Documents", extensions: MEDIA_EXT },
          { name: "All Files", extensions: ["*"] },
        ],
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
        toast.success(`Saved changes to ${results.length} file${results.length === 1 ? "" : "s"}.`);
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

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <div className="text-sm text-zinc-400">
          {items.length > 0 ? (
            <span className="flex items-center gap-2">
               <span className="font-medium text-zinc-200">{items.length} files</span>
               <span className="w-1 h-1 rounded-full bg-zinc-700"></span>
               <span className="text-blue-400 font-medium">{dirtyEditCount} unsaved edits</span>
            </span>
          ) : (
            "Select files to begin"
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={pickFiles}
            disabled={loading || saving}
            className="flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors disabled:opacity-50"
          >
            <Folder size={16} />
            {loading ? "Reading…" : "Select Files"}
          </button>
          <button
            onClick={saveAll}
            disabled={saving || dirtyFileCount === 0}
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
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <Plus size={12} />
                Add Column
              </button>
              {showColPicker && (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50">
                  <div className="p-2 border-b border-zinc-800">
                    <input
                      type="text"
                      autoFocus
                      value={colPickerSearch}
                      onChange={(e) => setColPickerSearch(e.target.value)}
                      placeholder="Search tags…"
                      className="w-full rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto py-1">
                    {filteredColTags.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-zinc-500">All tags added</p>
                    ) : (
                      filteredColTags.map((t) => (
                        <button
                          key={t.name}
                          onClick={() => {
                            setColumns((prev) => [...prev, t.name]);
                            setShowColPicker(false);
                            setColPickerSearch("");
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-zinc-800 transition-colors"
                        >
                          <span className="block font-mono text-xs text-zinc-200">{t.name}</span>
                          <span className="block text-[10px] text-zinc-500">{t.hint}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Table ── */}
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl shadow-black/20">
            <div className="max-h-[70vh] overflow-auto custom-scrollbar">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                  <tr>
                    <th className="sticky left-0 z-20 min-w-[300px] bg-zinc-900/95 backdrop-blur px-5 py-4 font-semibold border-b border-zinc-800">
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
                <tbody className="divide-y divide-zinc-800/50">
                  {items.map((item) => (
                    <tr
                      key={item.file_path}
                      className="hover:bg-zinc-800/50 transition-colors group"
                    >
                      <td
                        className="sticky left-0 z-10 min-w-[300px] bg-zinc-900 group-hover:bg-zinc-800/80 px-5 py-3 font-mono text-xs text-zinc-300 transition-colors"
                        title={item.file_path}
                      >
                        <div className="flex items-center gap-3">
                          <FileImage size={16} className="text-zinc-500 shrink-0" />
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
                              className={`w-full min-w-[150px] rounded-lg bg-zinc-950/50 border px-3 py-2 font-mono text-xs outline-none focus:bg-zinc-950 focus:ring-2 focus:ring-blue-500/30 disabled:opacity-40 transition-all ${
                                dirty
                                  ? "border-blue-500/30 text-blue-200"
                                  : "border-zinc-800/50 text-zinc-300 hover:border-zinc-700"
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
    <th className="group px-3 py-3 align-bottom font-medium border-b border-zinc-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] normal-case text-zinc-400 tracking-normal">{tag}</span>
        <button
          onClick={onRemove}
          className="p-0.5 text-zinc-600 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
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
          className="w-full min-w-[120px] rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs font-normal text-zinc-200 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
        />
        <button
          onClick={() => {
            if (bulkValue) {
               onApplyAll(bulkValue);
               setBulkValue("");
            }
          }}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
        >
          Apply
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-zinc-600 leading-snug">
        <span className="font-mono text-zinc-500">{"{filename}"}</span>{" "}name ·{" "}
        <span className="font-mono text-zinc-500">{"{ext}"}</span>{" "}ext ·{" "}
        <span className="font-mono text-zinc-500">{"{filename|match:S(\\d+)}"}</span>{" "}regex
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
