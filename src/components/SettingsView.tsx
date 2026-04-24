import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { COMMON_TAGS } from "../constants";
import { Settings } from "../hooks/useSettings";

export function SettingsView({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  const [showColPicker, setShowColPicker] = useState(false);
  const [colPickerSearch, setColPickerSearch] = useState("");
  const colPickerRef = useRef<HTMLDivElement>(null);

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

  const filteredColTags = useMemo(
    () =>
      COMMON_TAGS.filter(
        (t) =>
          !settings.defaultBatchColumns.includes(t.name) &&
          (!colPickerSearch ||
            t.name.toLowerCase().includes(colPickerSearch.toLowerCase()) ||
            t.hint.toLowerCase().includes(colPickerSearch.toLowerCase())),
      ),
    [settings.defaultBatchColumns, colPickerSearch],
  );

  function removeColumn(col: string) {
    onUpdate({ defaultBatchColumns: settings.defaultBatchColumns.filter((c) => c !== col) });
  }

  function addColumn(name: string) {
    onUpdate({ defaultBatchColumns: [...settings.defaultBatchColumns, name] });
    setShowColPicker(false);
    setColPickerSearch("");
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Preferences are saved automatically to local storage.
        </p>
      </div>

      {/* ── File Safety ── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-5 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          File Safety
        </h2>

        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100">Keep original file backups</p>
            <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed max-w-sm">
              When enabled, ExifTool creates a{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-300">
                _original
              </code>{" "}
              backup beside each file before writing. Disable to overwrite files directly and
              save disk space.
            </p>
          </div>

          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={settings.keepBackups}
            onClick={() => onUpdate({ keepBackups: !settings.keepBackups })}
            className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900 ${
              settings.keepBackups ? "bg-blue-600" : "bg-zinc-700"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                settings.keepBackups ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── Default Batch Columns ── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          Default Batch Columns
        </h2>
        <p className="mb-5 text-xs text-zinc-500">
          Columns shown by default when opening Batch Edit. You can always add or remove columns
          per session.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {settings.defaultBatchColumns.map((col) => (
            <span
              key={col}
              className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1 font-mono text-xs text-zinc-200"
            >
              {col}
              <button
                onClick={() => removeColumn(col)}
                className="text-zinc-500 hover:text-red-400 transition-colors"
                title={`Remove ${col}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}

          {/* Add Column picker */}
          <div ref={colPickerRef} className="relative">
            <button
              onClick={() => { setShowColPicker((v) => !v); setColPickerSearch(""); }}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-zinc-700 px-3 py-1 text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <Plus size={11} />
              Add
            </button>

            {showColPicker && (
              <div className="absolute left-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50">
                <div className="border-b border-zinc-800 p-2">
                  <input
                    type="text"
                    autoFocus
                    value={colPickerSearch}
                    onChange={(e) => setColPickerSearch(e.target.value)}
                    placeholder="Search tags…"
                    className="w-full rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto py-1 custom-scrollbar">
                  {filteredColTags.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-zinc-500">All tags added</p>
                  ) : (
                    filteredColTags.map((t) => (
                      <button
                        key={t.name}
                        onClick={() => addColumn(t.name)}
                        className="w-full px-3 py-2 text-left transition-colors hover:bg-zinc-800"
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

          {settings.defaultBatchColumns.length === 0 && (
            <span className="text-xs text-zinc-600 italic">No default columns — add one above.</span>
          )}
        </div>
      </div>
    </section>
  );
}
