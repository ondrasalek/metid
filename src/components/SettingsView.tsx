import { useMemo, type ReactNode } from "react";
import { Monitor, Moon, Plus, Sun, X } from "lucide-react";
import { COMMON_TAGS } from "../constants";
import type { Settings } from "../hooks/useSettings";
import type { Theme } from "../hooks/useTheme";
import { Segmented, Switch, TagPicker, Toolbar } from "./ui";

const THEME_OPTIONS: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: "system", label: "System", icon: <Monitor size={13} /> },
  { value: "light", label: "Light", icon: <Sun size={13} /> },
  { value: "dark", label: "Dark", icon: <Moon size={13} /> },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 px-1 text-[11px] font-semibold text-fg-4">{title}</h2>
      <div className="divide-y divide-line rounded-lg border border-line bg-panel">{children}</div>
    </section>
  );
}

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-fg">{title}</p>
        {description && <p className="mt-0.5 max-w-md text-xs leading-relaxed text-fg-4">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsView({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  const availableTags = useMemo(
    () => COMMON_TAGS.filter((t) => !settings.defaultBatchColumns.includes(t.name)),
    [settings.defaultBatchColumns],
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar title="Settings" />
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-app px-6 py-6">
        <div className="mx-auto max-w-xl space-y-6">
          <Group title="Appearance">
            <Row title="Theme" description="Follow the system setting, or pick one.">
              <Segmented
                value={settings.theme}
                onChange={(theme) => onUpdate({ theme })}
                options={THEME_OPTIONS}
              />
            </Row>
          </Group>

          <Group title="File Safety">
            <Row
              title="Keep original file backups"
              description={
                <>
                  ExifTool writes an{" "}
                  <code className="rounded bg-elevated px-1 font-mono text-fg-2">_original</code> copy
                  beside each file before changing it. Turn off to overwrite in place and save disk space.
                </>
              }
            >
              <Switch
                checked={settings.keepBackups}
                onChange={(keepBackups) => onUpdate({ keepBackups })}
                label="Keep original file backups"
              />
            </Row>
          </Group>

          <Group title="Batch Edit">
            <div className="px-4 py-3">
              <p className="text-[13px] font-medium text-fg">Default columns</p>
              <p className="mb-3 mt-0.5 text-xs text-fg-4">
                Shown when you start Batch Edit. You can still add or remove columns per session.
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {settings.defaultBatchColumns.map((col) => (
                  <span
                    key={col}
                    className="flex h-6 items-center gap-1 rounded-full bg-elevated pl-2.5 pr-1.5 text-xs text-fg"
                  >
                    {col}
                    <button
                      onClick={() =>
                        onUpdate({ defaultBatchColumns: settings.defaultBatchColumns.filter((c) => c !== col) })
                      }
                      title={`Remove ${col}`}
                      className="rounded-full p-0.5 text-fg-4 hover:bg-ovl/10 hover:text-red-500"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <TagPicker
                  tags={availableTags}
                  align="left"
                  emptyText="All tags added"
                  onPick={(name) =>
                    onUpdate({ defaultBatchColumns: [...settings.defaultBatchColumns, name] })
                  }
                  renderTrigger={({ onClick }) => (
                    <button
                      onClick={onClick}
                      className="flex h-6 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-xs text-fg-4 hover:text-fg"
                    >
                      <Plus size={11} /> Add
                    </button>
                  )}
                />
                {settings.defaultBatchColumns.length === 0 && (
                  <span className="text-xs italic text-fg-5">No default columns</span>
                )}
              </div>
            </div>
          </Group>
        </div>
      </div>
    </div>
  );
}
