import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  ChevronRight, FileText, FolderOpen, Lock, Plus, RotateCcw, Save, Search, Trash2, Undo2,
} from "lucide-react";
import { COMMON_TAGS, categorizeFile, hasWritableMetadata } from "../constants";
import { MOD_LABEL } from "../hooks/useHotkeys";
import { useCommands } from "../lib/commands";
import {
  DIALOG_FILTERS, basename, confirmDiscard, dirname, errorOf, formatValue, groupOf,
  isReadOnlyGroup, isWritable, saveFilesMetadata, shortName, type Metadata,
} from "../lib/metadata";
import {
  Button, EmptyState, SearchField, Segmented, StatusBar, TagPicker, Toolbar,
  type TagPickerHandle,
} from "./ui";

const ADDED_GROUP = "Added";

type Row = { key: string; group: string; name: string; value: unknown; isNew: boolean };

export function SingleFileView({
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
  const [scope, setScope] = useState<"all" | "editable">("all");
  // Per-group open/closed overrides; read-only groups default to collapsed.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const filterRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<TagPickerHandle>(null);

  const dirtyCount = Object.keys(edits).length;
  const hasPending = dirtyCount > 0 || newTags.size > 0;

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

  async function pickAndRead() {
    if (hasPending && !(await confirmDiscard("Opening another file will discard your unsaved changes."))) {
      return;
    }
    try {
      const selected = await open({ multiple: false, filters: DIALOG_FILTERS });
      if (typeof selected !== "string") return;
      setFilePath(selected);
      await loadMetadata(selected);
    } catch {
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
      const err = errorOf(e);
      toast.error(err.kind || "Error reading metadata", { description: err.message });
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

  function revertRow(key: string) {
    setEdits((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }

  function removeNewTag(key: string) {
    setNewTags((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    revertRow(key);
  }

  function addTag(name: string) {
    setNewTags((prev) => new Set(prev).add(name));
    setFilter("");
    setScope("all");
    setOpenGroups((g) => ({ ...g, [ADDED_GROUP]: true }));
    // Land the cursor in the new row once it renders.
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(`[data-tag-input="${CSS.escape(name)}"]`)?.focus(),
    );
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
      toast.error("Failed to save changes", { description: errorOf(e).message });
    } finally {
      setSaving(false);
    }
  }

  const existingTagNames = useMemo(() => {
    if (!metadata) return new Set<string>();
    return new Set(Object.keys(metadata).map((k) => shortName(k).toLowerCase()));
  }, [metadata]);

  // Broad category of the open file; null = unknown, so only universal tags show.
  const fileCategory = useMemo(() => (filePath ? categorizeFile(filePath) : null), [filePath]);

  // Plain-text formats (.txt/.md/.rtf) have no metadata container — writing
  // returns `ToolError: exit Some(1)`, so Save and Add Tag are disabled.
  const isReadOnlyFormat = useMemo(
    () => (filePath ? !hasWritableMetadata(filePath) : false),
    [filePath],
  );

  const pickerTags = useMemo(
    () =>
      COMMON_TAGS.filter((t) => {
        if (newTags.has(t.name)) return false;
        if (existingTagNames.has(t.name.toLowerCase())) return false;
        // Tags without `formats` are universal; others only show for matching categories.
        if (t.formats && (!fileCategory || !t.formats.includes(fileCategory))) return false;
        return true;
      }),
    [existingTagNames, newTags, fileCategory],
  );

  const q = filter.trim().toLowerCase();

  // Flat rows → grouped sections. "Added" (new, unsaved tags) float to the top;
  // read-only groups (File, System…) sink to the bottom.
  const sections = useMemo(() => {
    if (!metadata) return [];
    const rows: Row[] = [];
    for (const [key, value] of Object.entries(metadata)) {
      if (scope === "editable" && !isWritable(key)) continue;
      if (q && !key.toLowerCase().includes(q) && !String(value).toLowerCase().includes(q)) continue;
      rows.push({ key, group: groupOf(key), name: shortName(key), value, isNew: false });
    }
    for (const tag of newTags) {
      if (tag in metadata) continue;
      if (q && !tag.toLowerCase().includes(q)) continue;
      rows.push({ key: tag, group: ADDED_GROUP, name: tag, value: undefined, isNew: true });
    }
    const byGroup = new Map<string, Row[]>();
    for (const r of rows) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
    const rank = (g: string) => (g === ADDED_GROUP ? 0 : isReadOnlyGroup(g) ? 2 : 1);
    return [...byGroup.entries()]
      .map(([group, groupRows]) => ({ group, rows: groupRows }))
      .sort((a, b) => rank(a.group) - rank(b.group));
  }, [metadata, q, scope, newTags]);

  const matchCount = sections.reduce((n, s) => n + s.rows.length, 0);
  const totalCount = metadata ? Object.keys(metadata).length : 0;

  function isOpen(group: string) {
    if (q) return true; // searching: show every match
    return openGroups[group] ?? !isReadOnlyGroup(group);
  }

  // Report pending edits to the parent (sidebar + quit guards); clear on unmount.
  useEffect(() => {
    onDirtyChange?.(hasPending);
    return () => onDirtyChange?.(false);
  }, [hasPending]); // eslint-disable-line react-hooks/exhaustive-deps

  useCommands({
    open: () => { if (!loading && !saving) pickAndRead(); },
    save: () => { if (!saving && dirtyCount > 0 && !isReadOnlyFormat) save(); },
    revert: () => { if (hasPending && !saving) discard(); },
    add: () => { if (metadata && !isReadOnlyFormat) pickerRef.current?.open(); },
    find: () => { filterRef.current?.focus(); filterRef.current?.select(); },
  });

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar
        title={
          filePath ? (
            <span className="flex items-center gap-1.5">
              {basename(filePath)}
              {hasPending && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" title="Unsaved changes" />}
            </span>
          ) : (
            "Single File"
          )
        }
        subtitle={filePath ? <span data-selectable>{dirname(filePath)}</span> : undefined}
      >
        {hasPending && (
          <Button variant="ghost" icon={<RotateCcw size={13} />} onClick={discard} disabled={saving} title="Discard unsaved changes">
            Discard
          </Button>
        )}
        <Button
          icon={<FolderOpen size={14} />}
          onClick={pickAndRead}
          disabled={loading || saving}
          title={`Open file (${MOD_LABEL}O)`}
        >
          {loading ? "Reading…" : "Open…"}
        </Button>
        {metadata && (
          <Button
            variant="primary"
            icon={<Save size={14} />}
            onClick={save}
            disabled={saving || dirtyCount === 0 || isReadOnlyFormat}
            title={isReadOnlyFormat ? "This format has no internal metadata container" : `Save changes (${MOD_LABEL}S)`}
          >
            {saving ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount} Change${dirtyCount === 1 ? "" : "s"}` : "Save"}
          </Button>
        )}
      </Toolbar>

      {!metadata ? (
        <div className="min-h-0 flex-1">
          <EmptyState
            icon={<FileText size={44} strokeWidth={1.25} />}
            title={filePath && loading ? "Reading metadata…" : "No File Open"}
            description="Open a file, or drop one anywhere in this window, to inspect and edit its metadata."
            action={
              <Button variant="primary" icon={<FolderOpen size={14} />} onClick={pickAndRead} disabled={loading}>
                Open File…
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {isReadOnlyFormat && (
            <div className="flex shrink-0 items-start gap-2.5 border-b border-amber-500/20 bg-amber-500/[0.07] px-4 py-2">
              <Lock size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                <span className="font-medium">Read-only format.</span> Plain-text files (.txt, .md, .rtf)
                have no metadata container, so only filesystem attributes are shown.
              </p>
            </div>
          )}

          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-4 py-2">
            <SearchField
              value={filter}
              onChange={setFilter}
              placeholder={`Filter tags (${MOD_LABEL}F)`}
              inputRef={filterRef}
              className="w-64"
            />
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { value: "all", label: "All" },
                { value: "editable", label: "Editable" },
              ]}
            />
            <div className="flex-1" />
            <TagPicker
              ref={pickerRef}
              tags={pickerTags}
              onPick={addTag}
              renderTrigger={({ onClick }) => (
                <Button
                  onClick={onClick}
                  disabled={isReadOnlyFormat}
                  icon={<Plus size={14} />}
                  title={isReadOnlyFormat ? "This format has no internal metadata container" : `Add tag (${MOD_LABEL}T)`}
                >
                  Add Tag
                </Button>
              )}
            />
          </div>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-app">
            {matchCount === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <Search size={26} className="mb-3 text-fg-5" strokeWidth={1.5} />
                <p className="text-[13px] text-fg-3">
                  {scope === "editable" && !q ? "No editable tags in this file" : "No tags match your filter"}
                </p>
                <button
                  onClick={() => { setFilter(""); setScope("all"); }}
                  className="mt-2 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              sections.map(({ group, rows }) => {
                const expanded = isOpen(group);
                return (
                  <section key={group}>
                    <button
                      onClick={() => setOpenGroups((g) => ({ ...g, [group]: !expanded }))}
                      aria-expanded={expanded}
                      className="sticky top-0 z-10 flex h-7 w-full items-center gap-1.5 border-b border-line bg-elevated/95 px-3 text-left text-[11px] font-semibold text-fg-3 backdrop-blur hover:text-fg"
                    >
                      <ChevronRight size={12} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                      {group}
                      {isReadOnlyGroup(group) && <Lock size={10} className="text-fg-5" />}
                      <span className="font-normal text-fg-5">{rows.length}</span>
                    </button>
                    {expanded && rows.map((row) => (
                      <TagRow
                        key={row.key}
                        row={row}
                        edited={row.key in edits ? edits[row.key] : undefined}
                        onChange={(v) => setEdit(row.key, v)}
                        onRevert={() => revertRow(row.key)}
                        onRemove={() => removeNewTag(row.key)}
                      />
                    ))}
                  </section>
                );
              })
            )}
          </div>

          <StatusBar
            left={
              <>
                <span>{q || scope === "editable" ? `${matchCount} of ${totalCount} tags` : `${totalCount} tags`}</span>
                {hasPending && (
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    {dirtyCount} unsaved edit{dirtyCount === 1 ? "" : "s"}
                  </span>
                )}
              </>
            }
            right={<span>{keepBackups ? "Backups on" : "Backups off"}</span>}
          />
        </>
      )}
    </div>
  );
}

function TagRow({
  row, edited, onChange, onRevert, onRemove,
}: {
  row: Row;
  edited: string | undefined;
  onChange: (v: string) => void;
  onRevert: () => void;
  onRemove: () => void;
}) {
  const writable = row.isNew || isWritable(row.key);
  const isDirty = edited !== undefined;
  const display = isDirty ? edited : formatValue(row.value);

  return (
    <div
      className={`group relative flex min-h-8 items-center gap-3 border-b border-line/60 py-0.5 pl-4 pr-3 ${
        isDirty ? "bg-blue-500/[0.06]" : row.isNew ? "bg-emerald-500/[0.06]" : "hover:bg-ovl/[0.03]"
      }`}
    >
      {(isDirty || row.isNew) && (
        <span className={`absolute inset-y-0 left-0 w-0.5 ${row.isNew ? "bg-emerald-500" : "bg-blue-500"}`} />
      )}
      <div className="flex w-[30%] min-w-[120px] shrink-0 items-center gap-1.5">
        <span className="truncate text-[13px] text-fg-3" title={row.key}>
          {row.name}
        </span>
        {row.isNew && (
          <span className="rounded bg-emerald-500/15 px-1 text-[10px] font-medium uppercase text-emerald-600 dark:text-emerald-400">
            New
          </span>
        )}
      </div>
      <input
        type="text"
        data-tag-input={row.key}
        disabled={!writable}
        value={display}
        spellCheck={false}
        placeholder={row.isNew ? "Enter value…" : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && isDirty) {
            e.stopPropagation();
            onRevert();
          }
        }}
        title={writable ? undefined : "Read-only"}
        className={`h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 font-mono text-xs outline-none transition-colors ${
          writable
            ? "text-fg hover:border-line-strong focus:border-blue-500/60 focus:bg-panel focus:ring-2 focus:ring-blue-500/20"
            : "text-fg-4"
        } ${isDirty ? "text-blue-700 dark:text-blue-200" : ""}`}
      />
      <div className="flex w-6 shrink-0 justify-center">
        {row.isNew ? (
          <button onClick={onRemove} title="Remove tag" className="rounded p-1 text-fg-4 opacity-0 hover:bg-red-500/10 hover:text-red-500 focus:opacity-100 group-hover:opacity-100">
            <Trash2 size={13} />
          </button>
        ) : isDirty ? (
          <button onClick={onRevert} title="Revert this edit (Esc)" className="rounded p-1 text-fg-4 opacity-0 hover:bg-ovl/10 hover:text-fg focus:opacity-100 group-hover:opacity-100">
            <Undo2 size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
