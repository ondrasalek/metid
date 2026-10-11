import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { AlertCircle, FileText, FolderOpen, Plus, RotateCcw, Save, Table2, X } from "lucide-react";
import { COMMON_TAGS, categorizeFile } from "../constants";
import { MOD_LABEL } from "../hooks/useHotkeys";
import { useCommands } from "../lib/commands";
import {
  DIALOG_FILTERS, basename, confirmDiscard, containsTemplate, errorOf, findMetadataValue,
  formatValue, isWritable, naturalSortPaths, resolveVariables,
  type BatchItem, type BulkSaveResult, type FileUpdate,
} from "../lib/metadata";
import { Button, EmptyState, StatusBar, TagPicker, Toolbar, type TagPickerHandle } from "./ui";

export function BatchView({
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
  const pickerRef = useRef<TagPickerHandle>(null);

  // Shared category across the loaded batch — null when empty or mixed (format
  // gating only kicks in when every file shares a single category).
  const batchCategory = useMemo(() => {
    if (items.length === 0) return null;
    const cats = new Set(items.map((i) => categorizeFile(i.file_path)));
    if (cats.size !== 1) return null;
    return cats.values().next().value ?? null;
  }, [items]);

  const availableTags = useMemo(
    () =>
      COMMON_TAGS.filter(
        (t) =>
          !columns.includes(t.name) &&
          !(t.formats && batchCategory && !t.formats.includes(batchCategory)),
      ),
    [columns, batchCategory],
  );

  const dirtyFileCount = Object.keys(edits).length;
  const dirtyEditCount = Object.values(edits).reduce((n, e) => n + Object.keys(e).length, 0);

  // Report pending edits to the parent (sidebar + quit guards); clear on unmount.
  useEffect(() => {
    onDirtyChange?.(dirtyFileCount > 0);
    return () => onDirtyChange?.(false);
  }, [dirtyFileCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Files dropped onto the window merge into the existing selection (edits kept)
  useEffect(() => {
    if (!droppedFiles?.length) return;
    addFilesToSelection(droppedFiles);
    onDropHandled?.();
  }, [droppedFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addFilesToSelection(paths: string[]) {
    const existingPaths = new Set(items.map((i) => i.file_path));
    const novel = paths.filter((p) => !existingPaths.has(p)).sort(naturalSortPaths);
    if (novel.length === 0) return;
    setLoading(true);
    try {
      const newItems = await invoke<BatchItem[]>("read_metadata_batch", { filePaths: novel });
      // Merge and re-sort so newly added files land in the right position
      setItems((prev) =>
        [...prev, ...newItems].sort((a, b) => naturalSortPaths(a.file_path, b.file_path)),
      );
    } catch (e) {
      const err = errorOf(e);
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
      const selected = await open({ multiple: true, filters: DIALOG_FILTERS });
      if (!Array.isArray(selected) || selected.length === 0) return;

      setLoading(true);
      const sorted = [...selected].sort(naturalSortPaths);
      const results = await invoke<BatchItem[]>("read_metadata_batch", { filePaths: sorted });
      setItems(results);
      setEdits({});
    } catch (e) {
      const err = errorOf(e);
      toast.error(err.kind || "Failed to load files", { description: err.message });
    } finally {
      setLoading(false);
    }
  }

  function setCellEdit(filePath: string, tag: string, value: string) {
    setEdits((prev) => {
      const item = items.find((i) => i.file_path === filePath);
      const original = item?.metadata ? formatValue(findMetadataValue(item.metadata, tag)) : "";
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
        const original = formatValue(findMetadataValue(item.metadata, tag));
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

      // Capture before the save — `edits` is cleared right after.
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
      const err = errorOf(e);
      toast.error(err.kind || "Save failed", { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  useCommands({
    open: () => { if (!loading && !saving) pickFiles(); },
    save: () => { if (!saving && dirtyFileCount > 0) saveAll(); },
    revert: () => { if (!saving) setEdits({}); },
    add: () => { if (items.length > 0) pickerRef.current?.open(); },
  });

  // Spreadsheet-style navigation: Enter moves to the same column, next row.
  function onCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = document.querySelector<HTMLInputElement>(
      `[data-cell="${e.shiftKey ? row - 1 : row + 1}-${col}"]`,
    );
    next?.focus();
    next?.select();
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar
        title="Batch Edit"
        subtitle={
          items.length > 0
            ? `${items.length} file${items.length === 1 ? "" : "s"}`
            : "Edit many files side by side"
        }
      >
        {dirtyFileCount > 0 && (
          <Button variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setEdits({})} disabled={saving} title="Discard all unsaved edits">
            Discard
          </Button>
        )}
        {items.length > 0 && (
          <TagPicker
            ref={pickerRef}
            tags={availableTags}
            onPick={(name) => setColumns((prev) => [...prev, name])}
            emptyText="All tags already added"
            renderTrigger={({ onClick }) => (
              <Button onClick={onClick} icon={<Plus size={14} />} title={`Add column (${MOD_LABEL}T)`}>
                Add Column
              </Button>
            )}
          />
        )}
        <Button
          icon={<FolderOpen size={14} />}
          onClick={pickFiles}
          disabled={loading || saving}
          title={`Select files (${MOD_LABEL}O)`}
        >
          {loading ? "Reading…" : "Select Files…"}
        </Button>
        <Button
          variant="primary"
          icon={<Save size={14} />}
          onClick={saveAll}
          disabled={saving || dirtyFileCount === 0}
          title={`Save all changes (${MOD_LABEL}S)`}
        >
          {saving ? "Saving…" : dirtyFileCount > 0 ? `Save ${dirtyFileCount} File${dirtyFileCount === 1 ? "" : "s"}` : "Save All"}
        </Button>
      </Toolbar>

      {items.length === 0 ? (
        <div className="min-h-0 flex-1">
          <EmptyState
            icon={<Table2 size={44} strokeWidth={1.25} />}
            title="No Files Selected"
            description="Select multiple files, or drop them anywhere in this window, to edit their metadata side by side."
            action={
              <Button variant="primary" icon={<FolderOpen size={14} />} onClick={pickFiles} disabled={loading}>
                Select Files…
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-auto bg-app">
            <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 w-[280px] min-w-[240px] border-b border-r border-line bg-panel px-3 py-2 text-[11px] font-semibold text-fg-3">
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
                  <th className="sticky top-0 z-20 w-full border-b border-line bg-panel" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, r) => (
                  <tr key={item.file_path} className="group">
                    <td
                      className="sticky left-0 z-10 w-[280px] min-w-[240px] max-w-[280px] border-b border-r border-line bg-panel px-3 py-1.5 group-hover:bg-elevated"
                      title={item.file_path}
                    >
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="shrink-0 text-fg-4" />
                        <span className="truncate text-xs text-fg-2">{basename(item.file_path)}</span>
                        {item.error && (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-red-500" title={item.error.message}>
                            <AlertCircle size={12} />
                            {item.error.kind}
                          </span>
                        )}
                      </div>
                    </td>
                    {columns.map((col, c) => {
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
                          className={`border-b border-r border-line/70 px-1 py-0.5 align-top ${
                            dirty ? "bg-blue-500/[0.07]" : "group-hover:bg-ovl/[0.03]"
                          }`}
                        >
                          <input
                            type="text"
                            data-cell={`${r}-${c}`}
                            disabled={!!item.error}
                            value={rawValue}
                            spellCheck={false}
                            onChange={(e) => setCellEdit(item.file_path, col, e.target.value)}
                            onKeyDown={(e) => onCellKeyDown(e, r, c)}
                            className={`h-7 w-full min-w-[170px] rounded border border-transparent bg-transparent px-2 font-mono text-xs outline-none focus:border-blue-500/60 focus:bg-panel focus:ring-2 focus:ring-blue-500/20 disabled:opacity-40 ${
                              dirty ? "text-blue-700 dark:text-blue-200" : "text-fg-2"
                            }`}
                          />
                          {preview !== null && (
                            <div className="truncate px-2 pb-0.5 font-mono text-[10px] text-blue-500/70">
                              → {preview || "(empty)"}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-line/70" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <StatusBar
            left={
              <>
                <span>{items.length} file{items.length === 1 ? "" : "s"}</span>
                {dirtyEditCount > 0 && (
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    {dirtyEditCount} unsaved edit{dirtyEditCount === 1 ? "" : "s"}
                  </span>
                )}
              </>
            }
            right={
              <span title="Template variables usable in any cell">
                <code className="font-mono">{"{filename}"}</code> · <code className="font-mono">{"{ext}"}</code> ·{" "}
                <code className="font-mono">{"{filename|match:S(\\d+)}"}</code>
              </span>
            }
          />
        </>
      )}
    </div>
  );
}

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

  function apply() {
    if (!bulkValue) return;
    onApplyAll(bulkValue);
    setBulkValue("");
  }

  return (
    <th className="group sticky top-0 z-20 min-w-[200px] border-b border-r border-line bg-panel px-2 py-1.5 align-bottom font-normal">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] font-semibold text-fg-3">{tag}</span>
        <button
          onClick={onRemove}
          title="Remove column"
          className="rounded p-0.5 text-fg-5 opacity-0 hover:bg-red-500/10 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex gap-1">
        <input
          type="text"
          value={bulkValue}
          onChange={(e) => setBulkValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
          placeholder="Apply to all…"
          spellCheck={false}
          className="h-6 min-w-0 flex-1 rounded border border-line-strong bg-app px-2 font-mono text-[11px] text-fg outline-none placeholder:text-fg-5 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20"
        />
        <button
          onClick={apply}
          disabled={!bulkValue}
          className="h-6 rounded bg-elevated px-2 text-[11px] font-medium text-fg-2 hover:bg-elevated2 disabled:text-fg-5 disabled:hover:bg-elevated"
        >
          Apply
        </button>
      </div>
    </th>
  );
}
