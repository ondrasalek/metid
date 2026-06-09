import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Monitor, Sun, Moon } from "lucide-react";
import { COMMON_TAGS } from "../constants";
import { Settings } from "../hooks/useSettings";
import { Theme } from "../hooks/useTheme";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

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
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Settings</h1>
        <p className="mt-1 text-sm text-fg-4">
          Preferences are saved automatically to local storage.
        </p>
      </div>

      {/* ── Appearance ── */}
      <div className="rounded-2xl border border-line bg-panel p-6">
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-fg-4">
          Appearance
        </h2>
        <p className="mb-5 text-xs text-fg-4">
          Choose a theme, or follow your operating system setting automatically.
        </p>

        <div className="inline-flex w-full max-w-sm gap-1 rounded-xl border border-line bg-app p-1">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = settings.theme === value;
            return (
              <button
                key={value}
                onClick={() => onUpdate({ theme: value })}
                aria-pressed={active}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-panel text-fg shadow-sm border border-line"
                    : "border border-transparent text-fg-4 hover:text-fg"
                }`}
              >
                <Icon size={15} strokeWidth={2} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── File Safety ── */}
      <div className="rounded-2xl border border-line bg-panel p-6">
        <h2 className="mb-5 text-[11px] font-semibold uppercase tracking-widest text-fg-4">
          File Safety
        </h2>

        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">Keep original file backups</p>
            <p className="mt-1.5 text-xs text-fg-4 leading-relaxed max-w-sm">
              When enabled, ExifTool creates a{" "}
              <code className="rounded bg-elevated px-1 py-0.5 font-mono text-fg-2">
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
              settings.keepBackups ? "bg-blue-600" : "bg-elevated2"
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
      <div className="rounded-2xl border border-line bg-panel p-6">
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-fg-4">
          Default Batch Columns
        </h2>
        <p className="mb-5 text-xs text-fg-4">
          Columns shown by default when opening Batch Edit. You can always add or remove columns
          per session.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {settings.defaultBatchColumns.map((col) => (
            <span
              key={col}
              className="flex items-center gap-1.5 rounded-full border border-line-strong bg-elevated px-3 py-1 font-mono text-xs text-fg"
            >
              {col}
              <button
                onClick={() => removeColumn(col)}
                className="text-fg-4 hover:text-red-400 transition-colors"
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
              className="flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 py-1 text-xs text-fg-4 hover:border-line-strong hover:text-fg-2 transition-colors"
            >
              <Plus size={11} />
              Add
            </button>

            {showColPicker && (
              <div className="absolute left-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl shadow-black/50">
                <div className="border-b border-line p-2">
                  <input
                    type="text"
                    autoFocus
                    value={colPickerSearch}
                    onChange={(e) => setColPickerSearch(e.target.value)}
                    placeholder="Search tags…"
                    className="w-full rounded-lg bg-elevated px-3 py-1.5 text-xs text-fg placeholder-fg-4 outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto py-1 custom-scrollbar">
                  {filteredColTags.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-fg-4">All tags added</p>
                  ) : (
                    filteredColTags.map((t) => (
                      <button
                        key={t.name}
                        onClick={() => addColumn(t.name)}
                        className="w-full px-3 py-2 text-left transition-colors hover:bg-elevated"
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

          {settings.defaultBatchColumns.length === 0 && (
            <span className="text-xs text-fg-5 italic">No default columns — add one above.</span>
          )}
        </div>
      </div>
    </section>
  );
}
